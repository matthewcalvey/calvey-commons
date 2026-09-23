#!/usr/bin/env node
// pour_nature_book.mjs — CALVEY+CLAUDE NATURE+ARCHITECTURE BOOK
// Builds the book's single public edition from text/ + the manifest's machine block.
// Zero dependencies. Run:  node pour_nature_book.mjs  [--root <book folder>]
// Single-sourced: the manifest is the only place the book order and rules live.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const argRoot = (() => { const i = process.argv.indexOf('--root'); return i > -1 ? process.argv[i + 1] : null; })();
const ROOT = argRoot ? path.resolve(argRoot) : path.resolve(path.dirname(new URL(import.meta.url).pathname));
const TEXT = path.join(ROOT, 'text');
const AUDIO = path.join(ROOT, 'audio');
const IMAGES = path.join(ROOT, 'images');
const MANIFEST = path.join(TEXT, 'NATURE_ARCHITECTURE_MANIFEST_v1.md');

const problems = [], notes = [];
const voiceQueue = [];   // transcripts whose spoken words are new or changed: these need (re)recording
const fail = m => { problems.push(m); };
const note = m => { notes.push(m); };

/* ---------- minimal YAML subset reader (maps, seqs, flow seqs, flow maps, scalars) ---------- */
function parseYaml(src) {
  const lines = src.split('\n').filter(l => l.trim() !== '' && !/^\s*#/.test(l));
  let i = 0;
  const indentOf = l => l.match(/^ */)[0].length;
  function stripComment(raw) {
    const s = raw.trim();
    if (s.startsWith('"') || s.startsWith("'")) {           // quoted: drop anything after the closing quote
      const q = s[0], end = s.indexOf(q, 1);
      return end > -1 ? s.slice(0, end + 1) : s;
    }
    if (s.startsWith('[') || s.startsWith('{')) return s;     // flow: leave to splitFlow
    const c = s.search(/\s#/);
    return c > -1 ? s.slice(0, c).trim() : s;
  }
  function scalar(raw) {
    let s = stripComment(raw);
    if (s === '') return '';
    if (s.startsWith('[') && s.endsWith(']')) return splitFlow(s.slice(1, -1)).map(scalar);
    if (s.startsWith('{') && s.endsWith('}')) {
      const o = {};
      for (const part of splitFlow(s.slice(1, -1))) { const k = part.indexOf(':'); if (k > -1) o[part.slice(0, k).trim()] = scalar(part.slice(k + 1)); }
      return o;
    }
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
    if (s === 'true') return true; if (s === 'false') return false;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    return s;
  }
  function splitFlow(s) {
    const out = []; let depth = 0, q = null, cur = '';
    for (const ch of s) {
      if (q) { cur += ch; if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === '[' || ch === '{') depth++;
      if (ch === ']' || ch === '}') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim() !== '') out.push(cur);
    return out.map(x => x.trim());
  }
  function parseBlock(indent) {
    // sequence?
    if (i < lines.length && indentOf(lines[i]) === indent && /^\s*- /.test(lines[i])) {
      const arr = [];
      while (i < lines.length && indentOf(lines[i]) === indent && /^\s*- /.test(lines[i])) {
        const rest = lines[i].slice(indent + 2);
        if (/^[A-Za-z_][\w-]*:/.test(rest)) {          // list of maps
          const obj = {};
          const k = rest.indexOf(':'); const key = rest.slice(0, k).trim(); const val = rest.slice(k + 1);
          i++;
          if (val.trim() === '') { const childIndent = i < lines.length ? indentOf(lines[i]) : 0; obj[key] = childIndent > indent ? parseBlock(childIndent) : null; }
          else obj[key] = scalar(val);
          const memberIndent = indent + 2;
          while (i < lines.length && indentOf(lines[i]) === memberIndent && !/^\s*- /.test(lines[i])) {
            const line = lines[i].trim(); const kk = line.indexOf(':');
            const key2 = line.slice(0, kk).trim(); const val2 = line.slice(kk + 1);
            i++;
            if (val2.trim() === '') { const ci = i < lines.length ? indentOf(lines[i]) : 0; obj[key2] = ci > memberIndent ? parseBlock(ci) : null; }
            else obj[key2] = scalar(val2);
          }
          arr.push(obj);
        } else { arr.push(scalar(rest)); i++; }
      }
      return arr;
    }
    // mapping
    const obj = {};
    while (i < lines.length && indentOf(lines[i]) === indent && !/^\s*- /.test(lines[i])) {
      const line = lines[i].trim(); const k = line.indexOf(':');
      const key = line.slice(0, k).trim(); const val = line.slice(k + 1);
      i++;
      if (val.trim() === '') { const ci = i < lines.length ? indentOf(lines[i]) : 0; obj[key] = ci > indent ? parseBlock(ci) : null; }
      else obj[key] = scalar(val);
    }
    return obj;
  }
  return parseBlock(indentOf(lines[0]));
}

/* ---------- markdown → html (constrained to what this book uses) ---------- */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const GRADE_FIRST = /^(inference:\s*)?(REQUIREMENT|GUIDELINE|RESEARCH FINDING)\b/;
const METHOD = /^(MEASURED|SIMULATED|ANALYTICAL|HEURISTIC)\b/;
const ABSENCE = /^(gap|access limit|documentary|absence|unmeasured|not applicable)\b/i;
// A grade bracket is [FIRST / SECOND ...], [FIRST], or a bare [SECOND]. It may carry trailing
// commentary and nested source marks, so match to the balanced closing bracket rather than by regex.
function renderGrades(s) {
  let out = '', i = 0;
  while (i < s.length) {
    if (s[i] !== '[') { out += s[i]; i++; continue; }
    const body = s.slice(i + 1);
    const mFirst = GRADE_FIRST.exec(body);
    const mLone = !mFirst && (METHOD.exec(body) || ABSENCE.exec(body));
    if (!mFirst && !mLone) { out += s[i]; i++; continue; }
    let depth = 0, j = i;
    for (; j < s.length; j++) {
      if (s[j] === '[') depth++;
      else if (s[j] === ']') { depth--; if (depth === 0) break; }
    }
    if (j >= s.length) { out += s[i]; i++; continue; }        // unbalanced: leave alone
    const inner = s.slice(i + 1, j);
    let html = '', rest = '';
    if (mFirst) {
      const infer = !!mFirst[1];
      let after = inner.slice(mFirst[0].length);
      let second = '';
      const mSlash = /^\s*\/\s*([^\];,—-]+)/.exec(after);
      if (mSlash) { second = mSlash[1].trim(); after = after.slice(mSlash[0].length); }
      const cls = second && METHOD.test(second) ? 'g2' : 'g3';
      html = `<span class="grade${infer ? ' grade-inf' : ''}">`
        + (infer ? `<span class="g0">inference</span>` : '')
        + `<span class="g1">${mFirst[2]}</span>`
        + (second ? `<span class="${cls}">${second}</span>` : '')
        + `</span>`;
      rest = after;
    } else {
      const word = mLone[0];
      const cls = METHOD.test(word) ? 'g2' : 'g3';
      html = `<span class="grade"><span class="${cls}">${word}</span></span>`;
      rest = inner.slice(word.length);
    }
    rest = rest.replace(/^[\s,;:—-]+/, '').trim();
    out += html;
    if (rest) out += ` <span class="grade-note">${rest}</span>`;
    i = j + 1;
  }
  return out;
}

function inline(raw, edition) {
  let s = esc(raw);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // bold first, allowing single asterisks (nested emphasis) inside; then emphasis
  s = s.replace(/\*\*((?:[^*]|\*(?!\*))+?)\*\*/g, (_, c) => `<strong>${c}</strong>`);
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, (_, a, c) => `${a}<em>${c}</em>`);
  s = renderGrades(s);
  // source marks and unfilled marks — never links; this book has no markdown links
  s = s.replace(/\[(verified[^\]]*)\]/g, (_, c) => `<span class="mk mk-v">${c}</span>`);
  s = s.replace(/\[(not opened[^\]]*)\]/g, (_, c) => `<span class="mk mk-n">${c}</span>`);
  s = s.replace(/\[(unfilled[^\]]*)\]/g, (_, c) =>
    UNFILLED_PLAIN ? `<span class="mk mk-u-plain">unfilled</span>` : `<span class="mk mk-u">${c}</span>`);
  return s;
}

const FIGKEYS = ['file', 'source', 'creator', 'date', 'license', 'changes', 'shows', 'alt', 'status'];

// Pixel size of a placed JPEG or PNG, so the page reserves its space before it loads. Zero dependencies.
function imageSize(file) {
  try {
    const b = fs.readFileSync(file);
    if (b.length > 24 && b.readUInt32BE(0) === 0x89504E47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b[0] === 0xFF && b[1] === 0xD8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xFF) { i++; continue; }
        const m = b[i + 1];
        if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7) || m === 0xFF) { i += (m === 0xFF ? 1 : 2); continue; }
        const len = b.readUInt16BE(i + 2);
        if ((m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7) || (m >= 0xC9 && m <= 0xCB) || (m >= 0xCD && m <= 0xCF))
          return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        i += 2 + len;
      }
    }
  } catch (e) {}
  return null;
}

// A licence named in the common short forms gets a link to its deed; anything else stays as stated.
function licenceLink(text) {
  const t = String(text || '');
  let url = null, m;
  if (/\bCC0\b/i.test(t)) url = 'https://creativecommons.org/publicdomain/zero/1.0/';
  else if (/Public Domain Mark/i.test(t)) url = 'https://creativecommons.org/publicdomain/mark/1.0/';
  else if ((m = t.match(/CC[ -]BY(-SA)?[ -](\d\.\d)/i))) url = `https://creativecommons.org/licenses/by${m[1] ? '-sa' : ''}/${m[2]}/`;
  return url ? `<a href="${url}" rel="license noopener">${esc(t)}</a>` : esc(t);
}

// One figure block, read without side effects. The pour reads each block twice: once to gather a
// chapter's images before its story is written, and once to print the block among the evidence.
function readFigure(lines) {
  const fig = {}; let title = '';
  for (const l of lines) {
    if (/^FIG /.test(l)) { title = l.replace(/^FIG\s*/, ''); continue; }
    const k = l.indexOf(':');
    if (k > -1) { const key = l.slice(0, k).trim(); if (FIGKEYS.includes(key)) fig[key] = l.slice(k + 1).trim(); }
  }
  const status = (fig.status || 'to be drawn').trim();
  const num = title.split('·')[0].trim();
  const name = title.includes('·') ? title.split('·').slice(1).join('·').trim() : title;

  // Resolve the artwork by slug, not by the spec's literal path: the drawings were filed by
  // chapter folder and several specs still name images/diagrams/. The thumbnails folder holds
  // copies, never originals.
  const slug = fig.file ? path.basename(fig.file).replace(/\.[a-z0-9]+$/i, '') : null;
  let art = null;
  if (slug) {
    for (const dir of fs.readdirSync(IMAGES, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== 'thumbs')) {
      for (const ext of ['.svg', '.jpg', '.png']) {
        const cand = path.join(IMAGES, dir.name, slug + ext);
        if (fs.existsSync(cand)) { art = cand; break; }
      }
      if (art) break;
    }
  }
  // The book's own drawings say so in their spec (source: original diagram…). Everything else is a
  // reproduction: it keeps its own licence, is never inlined, and is shown only once its licence has
  // been read at source and its creator and source page are recorded in the block.
  const own = /^original/i.test(fig.source || '');
  const licenceRead = /^ready/i.test(status) && !!fig.license && !/to confirm/i.test(fig.license);
  const credited = !!fig.creator && !/to confirm/i.test(fig.creator) && /^https?:\/\//i.test(fig.source || '');
  const shown = !!art && (own || (licenceRead && credited));
  return { fig, title, status, num, name, slug, art, own, licenceRead, credited, shown,
    rel: art ? `images/${path.basename(path.dirname(art))}/${path.basename(art)}` : null };
}

function renderFigureBlock(lines, edition, figStats) {
  const { fig, status, num, name, art, own, licenceRead, credited } = readFigure(lines);
  figStats.total++;
  let hasImage = !!art;
  const third = hasImage && !own;
  if (third) {
    if (!licenceRead) { fail(`FIG ${num}: an image file is present but its licence has not been read at source (status: ${status}) — not shown.`); hasImage = false; }
    else if (!credited) { fail(`FIG ${num}: a reproduced image lacks its creator or its source page — not shown.`); hasImage = false; }
  }
  const isSvg = hasImage && own && art.endsWith('.svg');
  const withheld = /^withheld/i.test(status);
  const cls = hasImage ? (third ? 'placed' : 'made') : /to be drawn/i.test(status) ? 'tbd' : /^ready/i.test(status) ? 'ready' : withheld ? 'withheld' : 'ltc';
  if (hasImage && !third) figStats.made++;
  else if (hasImage && third) {
    figStats.placed++;
    const rel = `images/${path.basename(path.dirname(art))}/${path.basename(art)}`;
    const kb = Math.round(fs.statSync(art).size / 1024);
    if (kb > 800) note(`FIG ${num}: ${rel} is ${kb} KB — heavier than the 800 KB the page is sized for.`);
    if (!fig.date || /to confirm/i.test(fig.date)) note(`FIG ${num}: reproduced without a date — record the date the source states, or 'date not stated at source'.`);
    figStats.placedList.push({ num, name, rel, creator: fig.creator, date: /to confirm/i.test(fig.date || '') ? '' : (fig.date || ''), license: fig.license, source: fig.source, changes: fig.changes || '' });
  }
  else if (/to be drawn/i.test(status)) figStats.drawn++;
  else if (/^ready/i.test(status)) figStats.ready++;
  else if (withheld) figStats.withheld++;
  else figStats.licence++;
  if (/^ready/i.test(status) && !fig.license && !art) fail(`FIG ${num}: status ready with no licence field — not rendered as an image.`);

  let picture;
  if (hasImage && isSvg) {
    // inline so the page's own colour variables reach the drawing in both themes
    // (a file's own <metadata>, such as a content-credentials manifest, stays in the file; it does not render and is not copied into the page)
    picture = fs.readFileSync(art, 'utf8').replace(/<\?xml[^>]*\?>\s*/, '').replace(/<!DOCTYPE[^>]*>\s*/, '')
      .replace(/\s*<metadata[\s\S]*?<\/metadata>\s*/g, '\n').replace(/\s+xmlns:c2pa="[^"]*"/g, '').trim();
  } else if (hasImage) {
    const sz = art.endsWith('.svg') ? null : imageSize(art);
    picture = `<img src="images/${path.basename(path.dirname(art))}/${path.basename(art)}" alt="${esc(fig.alt || '')}" loading="lazy" decoding="async"${sz ? ` width="${sz.w}" height="${sz.h}"` : ''}>`;
  } else {
    const why = /to be drawn/i.test(status) ? 'Diagram to be drawn'
      : /^ready/i.test(status) ? 'Photograph not yet placed — licence read at source'
      : withheld ? 'Withheld — ' + (status.replace(/^withheld\s*[—–:;,-]*\s*/i, '') || 'its licence does not allow reuse here')
      : 'Photograph withheld until its licence is read at source';
    picture = `<div class="fig-placeholder"><span class="fig-ph-label">${esc(why)}</span></div>`;
  }

  let meta;
  if (hasImage && !third) {
    meta = `<dt>source</dt><dd>${inline((fig.source || 'original diagram').replace(/^original diagram[;,]?\s*/i, '').trim() || 'drawn for this edition from the chapter’s own figures', edition)}</dd>
         <dt>drawing</dt><dd>original, drawn for this edition; reusable under the book’s licence</dd>`;
  } else if (hasImage && third) {
    const shown = fig.source.replace(/^https?:\/\/(www\.)?/i, '');
    meta = `<dt>creator</dt><dd>${inline(fig.creator, edition)}</dd>
         ${fig.date && !/to confirm/i.test(fig.date) ? `<dt>date</dt><dd>${inline(fig.date, edition)}</dd>` : ''}
         <dt>licence</dt><dd>${licenceLink(fig.license)} — the image keeps its own licence; the book’s licence does not cover it</dd>
         <dt>source</dt><dd><a href="${esc(fig.source)}" rel="noopener">${esc(shown.length > 90 ? shown.slice(0, 87) + '…' : shown)}</a></dd>
         ${fig.changes ? `<dt>changes</dt><dd>${inline(fig.changes, edition)}</dd>` : ''}`;
  } else {
    meta = `${fig.source ? `<dt>source</dt><dd>${inline(fig.source, edition)}</dd>` : ''}
         <dt>licence</dt><dd>${fig.license ? inline(fig.license, edition) : '<em>not read at source — nothing fetched</em>'}</dd>`;
  }

  return `<figure class="fig ${cls}" id="fig-${esc(num).replace(/\./g, '-')}">
  <div class="fig-head"><span class="fig-num">FIG ${esc(num)}</span><span class="fig-status">${hasImage ? (third ? 'reproduced' : 'drawn') : esc(withheld ? 'withheld' : status)}</span></div>
  <div class="fig-title">${inline(name, edition)}</div>
  ${picture}
  ${fig.shows ? `<figcaption><strong>Shows.</strong> ${inline(fig.shows, edition)}</figcaption>` : ''}
  <dl class="fig-meta">
    ${meta}
  </dl>
</figure>`;
}

/* ---------- the illustrated reading: galleries, story plates, the viewer ---------- */
// A chapter opens on its images and its story. Its photographs and drawings are gathered from its
// figure blocks with the same licence gates as the blocks themselves; a withheld or unread image is
// never gathered. The evidence below the story still prints every block in full.
const THUMBS = path.join(IMAGES, 'thumbs');
function svgBox(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 600);
    const m = head.match(/viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/);
    if (m) return { w: Math.round(parseFloat(m[1])), h: Math.round(parseFloat(m[2])) };
  } catch (e) {}
  return { w: 640, h: 380 };
}
function collectFigures(md) {
  const out = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^FIG /.test(lines[i])) continue;
    const buf = [lines[i]];
    while (i + 1 < lines.length && /^[a-z]+:/.test(lines[i + 1])) buf.push(lines[++i]);
    const r = readFigure(buf);
    if (!r.shown) continue;
    const kind = r.own ? 'diagram' : 'photo';
    let size, thumb = null, thumbSize = null;
    if (r.art.endsWith('.svg')) size = svgBox(r.art);
    else {
      size = imageSize(r.art) || { w: 1200, h: 800 };
      const t = path.join(THUMBS, r.slug + '.jpg');
      if (fs.existsSync(t)) { thumb = `images/thumbs/${r.slug}.jpg`; thumbSize = imageSize(t); }
      else note(`FIG ${r.num}: no reduced copy in images/thumbs/ — its gallery tile loads the full image; run tools/make_cover_and_thumbnails.py.`);
    }
    out.push({ ...r, kind, size, thumb, thumbSize });
  }
  return out;
}
// Credits as a caption carries them: the creator's name without the notes after it, and the licence
// in its short form. The full lines stay in the block, the viewer and CREDITS.md.
function shortCredit(creator) {
  let s = String(creator || '').split(';')[0];
  s = s.replace(/,\s*(photographer|engraver)\b.*$/i, '').replace(/,?\s*as (Commons credits it|the museum records|Commons records it)\b.*$/i, '')
    .replace(/\s*\((?:[^()]*on Flickr|Flickr[^()]*|geograph[^()]*)\)/gi, '').replace(/\s*\((photograph [^)]*)\)/i, '').trim();
  if (s.length > 70) s = s.slice(0, 67).replace(/[\s,;]+\S*$/, '') + '…';
  return s;
}
function shortLicence(text) {
  const t = String(text || '');
  let m;
  if (/^public domain/i.test(t) || /Public Domain Mark/i.test(t)) return 'Public domain';
  if (/\bCC0\b/i.test(t)) return 'CC0';
  if ((m = t.match(/CC[ -]BY(-SA)?[ -]\d\.\d/i))) return m[0].replace(/-(?=\d)/, ' ');
  return t.split(/\s+[—(]/)[0];
}
function licenceUrl(text) {
  const t = String(text || ''); let m;
  if (/\bCC0\b/i.test(t)) return 'https://creativecommons.org/publicdomain/zero/1.0/';
  if (/Public Domain Mark/i.test(t)) return 'https://creativecommons.org/publicdomain/mark/1.0/';
  if ((m = t.match(/CC[ -]BY(-SA)?[ -](\d\.\d)/i))) return `https://creativecommons.org/licenses/by${m[1] ? '-sa' : ''}/${m[2]}/`;
  return null;
}
const plain = s => String(s || '').replace(/\*\*?|`/g, '').replace(/\s+/g, ' ').trim();
const figId = num => 'fig-' + String(num).replace(/\./g, '-');

// Where a photograph or drawing sits in the story. A photograph goes after the paragraph that names
// its subject; a drawing after the paragraph it matches best, one to a paragraph and never in two
// paragraphs running. What the story does not name stays in the chapter's gallery, unless the
// manifest pins it to a phrase.
const PLATE_STOP = new Set(('the a an and or of in on at to for from by with into onto over under between through across about as is are was were be been being it its this that these those their there than then which who whom whose what when where how why not no nor but so yet also only more most less least very much many some any each every other such same own both all one two three four five six seven eight nine ten first second third per via his her they them we our you your me my he she him shown shows show showing view views photograph photo photographer image drawing drawn diagram plan section detail details figure figures page left right top bottom whole part parts around near far early late later earlier original modern ancient century centuries year years ago bce ce circa known called used using use made make makes making built build building buildings house houses site sites form forms long short small large high low wide narrow new old great little well still just even since while during after before within without along among upon toward towards against beside inside outside above below behind beyond like unlike rather either neither whether because although though unless until museum commons credits credit records record collection library congress art metropolitan unknown anonymous signed del plate edition published printed digitised scanned retouched').split(/\s+/));
const PLATE_DEMONYM = new Set('japanese chinese persian roman greek egyptian islamic european indian english french italian spanish african american andean mesopotamian assyrian korean mughal british german dutch western eastern northern southern north south east west'.split(' '));
const pNorm = w => { w = w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']s$/, '').replace(/[^a-z0-9]/g, '');
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 4 && /(ch|sh|x|ss)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w; };
const pWords = s => (String(s || '').match(/[A-Za-zÀ-ÿĀ-žḀ-ỿ’'][A-Za-zÀ-ÿĀ-žḀ-ỿ’'-]*/g) || []).flatMap(w => w.split('-')).filter(Boolean);
const pToks = s => pWords(s).map(pNorm).filter(w => w.length >= 3 && !PLATE_STOP.has(w));
const pCaps = s => pWords(s).filter(w => /^[A-ZÀ-ÞĀ-Ž]/.test(w)).map(pNorm).filter(w => w.length >= 3 && !PLATE_STOP.has(w) && !PLATE_DEMONYM.has(w));
function planPlates(paras, figures, rules) {
  const ptoks = paras.map(p => new Set(pToks(p)));
  const pcaps = paras.map(p => new Set(pCaps(p)));
  const df = {}; ptoks.forEach(s => s.forEach(t => { df[t] = (df[t] || 0) + 1; }));
  const idf = t => ({ 1: 1, 2: .7, 3: .45 }[df[t]] || 0);
  const pin = (rules && rules.pin) || {}, skip = ((rules && rules.skip) || []).map(String);
  const cands = [];
  for (const f of figures) {
    if (skip.includes(f.num)) continue;
    if (pin[f.num] !== undefined) {
      const phrase = String(pin[f.num]);
      const i = paras.findIndex(p => p.includes(phrase));
      if (i < 0) fail(`FIG ${f.num}: its story plate is pinned to "${phrase}", which no paragraph of the story contains.`);
      else cands.push({ f, p: i, score: 99 });
      continue;
    }
    if (/\b(timeline|map)\b|in time and place/i.test(f.name)) continue;      // these belong to the gallery
    const w = {};
    const add = (s, wt) => pToks(s).forEach(t => { w[t] = Math.max(w[t] || 0, wt); });
    add(f.fig.shows, 1); add(f.fig.alt, 1); add(f.name, 3);
    const names = new Set(pCaps(f.name));
    if (f.kind === 'photo') pCaps(String(f.fig.creator || '').split(';')[0]).forEach(t => { w[t] = Math.max(w[t] || 0, 2); names.add(t); });
    let best = -1, bs = 0, bhits = 0, bnames = 0;
    ptoks.forEach((set, i) => {
      let s = 0, hits = 0, nm = 0;
      for (const t in w) if (set.has(t)) { const v = w[t] * idf(t); if (v) { s += v; hits++; if (names.has(t) && pcaps[i].has(t) && df[t] <= 2) nm++; } }
      if (s > bs) { bs = s; best = i; bhits = hits; bnames = nm; }
    });
    const ok = f.kind === 'photo' ? (bs >= 3 && bnames > 0) || bs >= 6 : bs >= 6 && bhits >= 3;
    if (ok) cands.push({ f, p: best, score: bs });
  }
  const at = paras.map(() => ({ photos: [], diagram: null }));
  for (const c of cands.filter(c => c.f.kind === 'photo')) if (at[c.p].photos.length < 4) at[c.p].photos.push(c.f);
  for (const c of cands.filter(c => c.f.kind === 'diagram').sort((a, b) => b.score - a.score)) {
    const near = [c.p - 1, c.p, c.p + 1].some(i => i >= 0 && i < at.length && at[i].diagram);
    if (!near && at[c.p].photos.length < 3) at[c.p].diagram = c.f;
  }
  return at;
}

function imgTag(f, cls, sizes) {
  const alt = esc(plain(f.fig.alt || f.name));
  if (f.kind === 'diagram') return `<img class="dgm${cls ? ' ' + cls : ''}" src="${f.rel}" alt="${alt}" width="${f.size.w}" height="${f.size.h}" loading="lazy" decoding="async">`;
  const src = f.thumb || f.rel;
  const set = f.thumb && f.thumbSize ? ` srcset="${f.thumb} ${f.thumbSize.w}w, ${f.rel} ${f.size.w}w" sizes="${sizes}"` : '';
  const sz = f.thumbSize || f.size;
  return `<img${cls ? ` class="${cls}"` : ''} src="${src}"${set} alt="${alt}" width="${sz.w}" height="${sz.h}" loading="lazy" decoding="async">`;
}
function creditLine(f) {
  if (f.kind === 'diagram') return `<a href="#${figId(f.num)}">the figure, with its source</a>`;
  const lu = licenceUrl(f.fig.license);
  const lic = esc(shortLicence(f.fig.license));
  return `${esc(shortCredit(f.fig.creator))} · ${lu ? `<a href="${lu}" rel="license noopener">${lic}</a>` : lic} · <a href="${esc(f.fig.source)}" rel="noopener">source</a>`;
}
function renderPlates(list) {
  if (!list.length) return '';
  const one = list.length === 1;
  const sizes = one ? '(min-width: 1180px) 896px, (min-width: 760px) 656px, 100vw' : '(min-width: 1180px) 443px, (min-width: 760px) 323px, 50vw';
  return `<div class="plates n${list.length}${list.every(f => f.kind === 'diagram') ? ' dg' : ''}">${list.map(f => `
  <figure class="plate${f.kind === 'diagram' ? ' plate-d' : ''}">
    <a class="plate-img" href="${f.rel}" data-lb="${esc(f.num)}">${imgTag(f, '', sizes)}</a>
    <figcaption><span class="pl-num">Fig ${esc(f.num)}</span> <span class="pl-t">${inline(f.name)}</span><span class="pl-cr">${creditLine(f)}</span></figcaption>
  </figure>`).join('')}
</div>`;
}
function renderGallery(figs, kindWord) {
  if (!figs.length) return '';
  const ph = figs.filter(f => f.kind === 'photo').length, dg = figs.length - ph;
  const count = [ph ? `${ph} photograph${ph === 1 ? '' : 's'}` : '', dg ? `${dg} diagram${dg === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  return `<div class="gallery">
    <div class="gal-head"><span>Images in this ${kindWord}</span><span>${count}</span></div>
    <div class="gal-strip">${figs.map(f => `<a class="gal-tile${f.kind === 'diagram' ? ' gal-d' : ''}" href="${f.rel}" data-lb="${esc(f.num)}" title="Fig ${esc(f.num)} · ${esc(plain(f.name))}${f.kind === 'photo' ? ' — ' + esc(shortCredit(f.fig.creator)) + ' · ' + esc(shortLicence(f.fig.license)) : ''}">${imgTag(f, '', '240px')}</a>`).join('')}</div>
  </div>`;
}
// The viewer's record of each image: plain text only; the page builds its links.
function viewerEntry(f, set) {
  const e = { k: f.kind === 'photo' ? 'p' : 'd', src: f.rel, w: f.size.w, h: f.size.h, t: plain(f.name), a: plain(f.fig.alt || f.name), s: f.kind === 'photo' ? plain(f.fig.shows || '') : '', set };
  if (f.kind === 'photo') Object.assign(e, { c: plain(f.fig.creator), d: /to confirm/i.test(f.fig.date || '') ? '' : plain(f.fig.date || ''), l: plain(f.fig.license), lu: licenceUrl(f.fig.license) || '', u: f.fig.source, x: plain(f.fig.changes || '') });
  return e;
}

function mdToHtml(md, edition, figStats) {
  const lines = md.split('\n');
  const out = []; let i = 0; let listOpen = false;
  const closeList = () => { if (listOpen) { out.push('</ul>'); listOpen = false; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^FIG /.test(l)) {                       // figure block: FIG line + following key: lines
      closeList();
      const buf = [l]; i++;
      while (i < lines.length && /^[a-z]+:/.test(lines[i])) { buf.push(lines[i]); i++; }
      out.push(renderFigureBlock(buf, edition, figStats));
      continue;
    }
    if (/^```/.test(l)) { closeList(); const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; } i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue; }
    if (/^\s*$/.test(l)) { closeList(); i++; continue; }
    if (/^---+\s*$/.test(l)) { closeList(); out.push('<hr>'); i++; continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); const lv = Math.min(h[1].length + 1, 6); out.push(`<h${lv} id="${slug(h[2])}">${inline(h[2], edition)}</h${lv}>`); i++; continue; }
    if (/^\s*[-*]\s+/.test(l)) { if (!listOpen) { out.push('<ul>'); listOpen = true; } out.push(`<li>${inline(l.replace(/^\s*[-*]\s+/, ''), edition)}</li>`); i++; continue; }
    // paragraph
    const buf = [l]; i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,4}\s|FIG |---+\s*$|```)/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i])) { buf.push(lines[i]); i++; }
    closeList();
    out.push(`<p>${inline(buf.join(' '), edition)}</p>`);
  }
  closeList();
  return out.join('\n');
}

/* ---------- read the manifest ---------- */
if (!fs.existsSync(MANIFEST)) { console.error(`Manifest not found: ${MANIFEST}`); process.exit(1); }
const manifestRaw = fs.readFileSync(MANIFEST, 'utf8');
const ym = manifestRaw.match(/```yaml\n([\s\S]*?)```/);
if (!ym) { console.error('No ```yaml machine block in the manifest.'); process.exit(1); }
const M = parseYaml(ym[1]).nature_book_manifest;
const ANATOMY = M.anatomy_types.native_numbered;
const FORBIDDEN = M.audio_rules.forbidden_in_audio;
const RULES = M.public_strip_rules || M.share_strip_rules;
const STRIP_HEADINGS = RULES.drop_sections_whose_heading_matches;
const STRIP_LINES = RULES.drop_inline_lines_containing;
const STRIP_CLAUSE = RULES.strip_clause_from_rulebook_lines || null;
const UNFILLED_PLAIN = RULES.render_unfilled_as === 'plain';
const PLATES = M.story_plates || {};
// The credits file is linked where it renders: the repository's own page for it.
const CREDITS_URL = M.credits_url || 'https://github.com/matthewcalvey/calvey-commons/blob/main/nature-and-architecture/images/CREDITS.md';
// JSON set inside a script element: nothing in it may close the element.
const J = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const AUDIO_PREFIX = M.audio_prefix || 'na_';

/* ---------- cut a document by the anatomy headings ---------- */
// A bare horizontal rule is a separator between sections in the source, never content of the
// section above it. Six narratives once carried the rule before '## 02' into their transcripts,
// and the voice had nothing to say for it.
const RULE_LINE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
function trimRules(lines) {
  let a = 0, b = lines.length;
  while (a < b && (lines[a].trim() === '' || RULE_LINE.test(lines[a]))) a++;
  while (b > a && (lines[b - 1].trim() === '' || RULE_LINE.test(lines[b - 1]))) b--;
  return lines.slice(a, b);
}
function cut(doc) {
  const order = ['summary_heading', 'audio_heading', 'body_starts_at', '## 03 · CASE CARDS', ANATOMY.figures_heading, ANATOMY.rulebook_heading, ANATOMY.decisions_heading, ANATOMY.bibliography_heading];
  const heads = [ANATOMY.summary_heading, ANATOMY.audio_heading, ANATOMY.body_starts_at, '## 03 · CASE CARDS', ANATOMY.figures_heading, ANATOMY.rulebook_heading, ANATOMY.decisions_heading, ANATOMY.bibliography_heading];
  const lines = doc.split('\n');
  const idx = heads.map(h => lines.findIndex(l => l.trim() === h));
  idx.forEach((v, n) => { if (v === -1) fail(`heading not found: ${heads[n]}`); });
  const header = lines.slice(0, idx[0]).join('\n');
  const sections = heads.map((h, n) => {
    const start = idx[n], end = n + 1 < idx.length ? idx[n + 1] : lines.length;
    if (start === -1) return { heading: h, body: '' };
    return { heading: h, body: trimRules(lines.slice(start + 1, end === -1 ? lines.length : end)).join('\n').trim() };
  });
  return { header, sections };
}

/* ---------- build ---------- */
fs.mkdirSync(AUDIO, { recursive: true });
fs.mkdirSync(IMAGES, { recursive: true });

const items = M.chapters.filter(c => c.pour === true);
const built = [];
const hashes = {};

for (const c of items) {
  const src = c.sources[0];
  const file = path.join(TEXT, src.file);
  if (!fs.existsSync(file)) { fail(`missing source file for row ${c.id}: ${src.file}`); continue; }
  const doc = fs.readFileSync(file, 'utf8');
  const { header, sections } = cut(doc);
  const narrative = sections[1].body;

  // acceptance check 1 — audio transcript and forbidden tokens
  const hits = FORBIDDEN.filter(t => narrative.includes(t));
  if (hits.length) fail(`row ${c.id} narrative contains forbidden audio token(s): ${hits.map(h => JSON.stringify(h)).join(', ')}`);
  if (/^#{1,6}\s/m.test(narrative)) fail(`row ${c.id} narrative contains a markdown heading`);
  if (narrative.split('\n').some(l => RULE_LINE.test(l))) fail(`row ${c.id} narrative contains a horizontal rule`);
  const mute = narrative.split(/\n\s*\n/).filter(p => !/[A-Za-z]/.test(p));
  if (mute.length) fail(`row ${c.id} narrative has ${mute.length} paragraph(s) with nothing to voice: ${mute.map(p => JSON.stringify(p.trim().slice(0, 20))).join(', ')}`);
  const audioSlug = AUDIO_PREFIX + slug(c.title);
  const transcript = narrative.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  const tPath = path.join(AUDIO, `${audioSlug}.txt`);
  const tHash = crypto.createHash('sha256').update(transcript).digest('hex');
  const prevText = fs.existsSync(tPath) ? fs.readFileSync(tPath, 'utf8') : null;
  const prevHash = prevText === null ? null : crypto.createHash('sha256').update(prevText).digest('hex');
  // the spoken words: paragraphs that have something to say, whitespace folded
  const spoken = t => t.split(/\n\s*\n/).filter(p => /[A-Za-z]/.test(p)).map(p => p.replace(/\s+/g, ' ').trim()).join('\n\n');
  if (prevHash === tHash) note(`row ${c.id}: narrative unchanged (dedupe by hash) — transcript not rewritten`);
  else {
    fs.writeFileSync(tPath, transcript);
    if (prevText === null) voiceQueue.push({ id: c.id, file: `${audioSlug}.mp3`, why: 'new transcript' });
    else if (spoken(prevText) === spoken(transcript)) note(`row ${c.id}: transcript rewritten, spoken words unchanged — an existing recording stands`);
    else voiceQueue.push({ id: c.id, file: `${audioSlug}.mp3`, why: 'spoken words changed' });
  }
  hashes[c.id] = tHash.slice(0, 12);
  const words = narrative.split(/\s+/).filter(Boolean).length;
  const mins = Math.round(words / 150);

  built.push({ c, header, sections, audioSlug, words, mins, totalWords: doc.split(/\s+/).filter(Boolean).length });
}

function renderEdition(edition) {
  const figStats = { total: 0, drawn: 0, ready: 0, licence: 0, made: 0, placed: 0, withheld: 0, placedList: [] };
  const parts = [];
  const toc = [];
  const viewer = {}, sets = {}, plateStats = [];      // the image viewer's records, per-part order, story placements
  let publishedWords = 0;

  for (const b of built) {
    const { c, sections, audioSlug, words, mins, totalWords } = b;
    if (!c.editions.includes(edition)) continue;
    const id = `item-${c.id}`;
    const kind = c.kind === 'section' ? 'Section' : 'Chapter';
    const label = c.kind === 'section' ? c.title : `${parseInt(c.id, 10)} · ${c.title}`;
    const kindWord = kind.toLowerCase();

    // this part's images, photographs first, each kind in figure order
    const figSec = sections.find(s => s.heading === ANATOMY.figures_heading);
    const figs = figSec ? collectFigures(figSec.body) : [];
    const gallery = [...figs.filter(f => f.kind === 'photo'), ...figs.filter(f => f.kind === 'diagram')];
    gallery.forEach(f => { viewer[f.num] = viewerEntry(f, c.id); });
    sets[c.id] = gallery.map(f => f.num);
    const nPhotos = gallery.filter(f => f.kind === 'photo').length, nDiagrams = gallery.length - nPhotos;

    const lead = gallery[0];
    const counts = [nPhotos ? `${nPhotos} photograph${nPhotos === 1 ? '' : 's'}` : '', nDiagrams ? `${nDiagrams} diagram${nDiagrams === 1 ? '' : 's'}` : '', `listen ${mins} min`].filter(Boolean).join(' · ');
    toc.push(`<li><a href="#${id}">${lead ? `<span class="toc-img${lead.kind === 'diagram' ? ' toc-dg' : ''}">${imgTag(lead, '', '96px').replace(/ alt="[^"]*"/, ' alt=""')}</span>` : '<span class="toc-img"></span>'}<span class="toc-n">${c.kind === 'section' ? '&#8212;' : esc(c.id)}</span><span class="toc-t">${esc(c.title)}</span><span class="toc-s">${esc(c.sources[0].subtitle || '')}</span><span class="toc-c">${counts}</span></a></li>`);

    // the story: the narrative, paragraph by paragraph, with the images it names set after them
    const paras = sections[1].body.split(/\n\s*\n/).map(p => p.trim()).filter(p => /[A-Za-z]/.test(p));
    const plan = planPlates(paras, gallery, PLATES);
    const storyHtml = paras.map((p, i) => mdToHtml(p, edition, figStats)
      + renderPlates(plan[i].photos) + (plan[i].diagram ? renderPlates([plan[i].diagram]) : '')).join('\n');
    const inStory = plan.reduce((a, x) => a + x.photos.length + (x.diagram ? 1 : 0), 0);
    plateStats.push({ id: c.id, photos: plan.reduce((a, x) => a + x.photos.length, 0), nPhotos, diagrams: plan.filter(x => x.diagram).length, nDiagrams });
    const storyWords = paras.join(' ').split(/\s+/).filter(Boolean).length;

    const bodySections = sections.slice(2).filter(s => !STRIP_HEADINGS.some(m => s.heading.includes(m)));

    const stripLines = (md, heading) => {
      let lines = md.split('\n').filter(l => !STRIP_LINES.some(t => l.includes(t)));
      if (STRIP_CLAUSE && heading && /GENERATIVE RULEBOOK/.test(heading)) {
        lines = lines.map(l => {
          if (!l.startsWith('**R')) return l;
          const i = l.indexOf(' ' + STRIP_CLAUSE);
          return i > -1 ? l.slice(0, i).trimEnd() : l;          // removes Fit: … Decisions: …
        });
        // the section preamble describes the two clauses that are no longer here
        lines = lines.map(l => l.replace(
          / · fit with the vocabulary \(an inference, graded separately\) · unresolved architectural decisions \(collected in `## 06`\)/,
          ''));
      }
      // inline pointers to the decisions section, which is not published here
      return lines.join('\n')
        .replace(/\s*\(DFA-[\d.]+(?:\s*,\s*DFA-[\d.]+)*\)/g, '')
        .replace(/\s*[;,]\s*DFA-[\d.]+(?:\s*,\s*DFA-[\d.]+)*(?=\))/g, '')
        .replace(/\s*[;,]?\s*see\s+DFA-[\d.]+/gi, '');
    };

    // what this page actually shows of the item: the CALVEY_FORM layer is not counted
    const itemWords = [stripLines(sections[0].body, ''), sections[1].body,
      ...bodySections.map(s => stripLines(s.body, s.heading))].join(' ').split(/\s+/).filter(Boolean).length;
    publishedWords += itemWords;

    const subtopics = (c.subtopics || []).map(s => `<li>${esc(s)}</li>`).join('');
    // the evidence keeps the source's order; its labels say what each part is
    const EV_LABEL = h => /GRADED BODY/.test(h) ? 'The graded body' : /CASE CARDS/.test(h) ? 'Case cards'
      : /FIGURES/.test(h) ? 'Figures, with their credits' : /GENERATIVE RULEBOOK/.test(h) ? 'GENERATIVE RULEBOOK'
      : /BIBLIOGRAPHY/.test(h) ? 'Bibliography' : h.replace(/^##\s*[\d]+\s*·\s*/, '');
    const figCount = figSec ? (figSec.body.match(/^FIG /gm) || []).length : 0;

    parts.push(`<article class="item${c.kind === 'section' ? ' item-section' : ''}" id="${id}">
  <header class="item-h">
    <span class="item-kicker">${c.kind === 'section' ? kind : kind + ' ' + esc(c.id)}</span>
    <h2 class="item-title">${esc(label)}</h2>
    <p class="item-sub">${esc(c.sources[0].subtitle || '')}</p>
    <div class="sec-audio" data-track="${c.id}">
      <div class="play-row">
        <button class="play-btn" type="button" data-play="${c.id}" aria-label="Listen to this ${kindWord}"><span class="pi"></span><span class="pl">Listen</span></button>
        <span class="play-dur">${mins} min, read aloud</span>
        <span class="play-pos" data-pos="${c.id}"></span>
      </div>
      <p class="audio-missing">The narration for this ${kindWord} has not been added yet. What it reads is the story below, word for word.</p>
    </div>
  </header>
  ${renderGallery(gallery, kindWord)}
  <details class="item-d"${c.kind === 'section' ? ' open' : ''}>
    <summary class="item-s"><span class="rd"><span class="rd-open">Read the ${kindWord}</span><span class="rd-close">Close the ${kindWord}</span></span><span class="rd-meta">${storyWords.toLocaleString('en-GB')}-word story${inStory ? ` · ${inStory} image${inStory === 1 ? '' : 's'} in it` : ''} · then the evidence</span></summary>
    <div class="item-body">
      <div class="story">
${storyHtml}
      </div>

      <section class="evidence">
        <div class="ev-head">
          <h3>The evidence</h3>
          <p>The story above is told from this research. Here every claim carries two grades — what kind of statement it is, and where its number came from — and every source is cited, with what was verified and what was not.</p>
        </div>
        ${subtopics ? `<nav class="subtopics"><h4>What this ${kindWord} covers</h4><ul>${subtopics}</ul></nav>` : ''}
        <section class="sec">
          <details>
            <summary><h3>Summary of findings</h3></summary>
            <div class="sec-inner">${mdToHtml(stripLines(sections[0].body, ''), edition, figStats)}</div>
          </details>
        </section>
        ${bodySections.map(s => `<section class="sec">
          <details>
            <summary><h3>${esc(EV_LABEL(s.heading))}${/FIGURES/.test(s.heading) && figCount ? ` · ${figCount}` : ''}</h3></summary>
            <div class="sec-inner">${mdToHtml(stripLines(s.body, s.heading), edition, figStats)}</div>
          </details>
        </section>`).join('\n        ')}
      </section>
      <button class="item-close" type="button" data-close="${id}">Close the ${kindWord}</button>
    </div>
  </details>
</article>`);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(M.book_name)}</title>
<meta name="description" content="${esc(M.series)} — a compiled, graded and cited account of how nature has been brought into, around and to the threshold of buildings.">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#141513">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Space+Mono:wght@400&display=swap" rel="stylesheet">
<meta property="og:title" content="${esc(M.book_name)}">
<meta property="og:description" content="How nature has been brought into, around and to the threshold of buildings — and who measured any of it.">
<meta property="og:type" content="book">
<style>
/* CALVEY — Cormorant Garamond + Space Mono, accent #6A9CC4.
   Dark is the default here; the light theme is the CALVEY FORM palette exactly. */
:root{
  --font-head:'Cormorant Garamond',Georgia,'Times New Roman',serif;
  --font-body:'Cormorant Garamond',Georgia,'Times New Roman',serif;
  --font-label:'Space Mono','Courier New',Courier,monospace;
  --accent:#6A9CC4; --ok:#7AB87A; --hot:#C45C3E;
  /* dark is the default */
  --bg:#141513; --panel:#191A18; --surface:#1F211E;
  --ink:#ECEAE3; --dim:#B8B5AC; --mut:#8A8880;
  --line:#32352F; --line2:#262924; --grid:#1C1E1B;
  --rad:2px; --maxw:44rem;
}
@media (prefers-color-scheme:light){:root{
  --bg:#FFFFFF; --panel:#FFFFFF; --surface:#F5F5F5;
  --ink:#1A1A1A; --dim:#555555; --mut:#888888;
  --line:#DDDDDD; --line2:#EFEFEF; --grid:#F0EDE8;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--dim);
  font:300 19px/1.62 var(--font-body);letter-spacing:.004em}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px 7rem;
  padding-left:max(24px,env(safe-area-inset-left));padding-right:max(24px,env(safe-area-inset-right))}
h1,h2,h3,h4,h5,h6{font-family:var(--font-head);font-weight:300;color:var(--ink);line-height:1.2}
strong,b{font-weight:400;color:var(--ink)}
em,i{font-style:italic}
a{color:var(--accent);text-decoration:none;border-bottom:.5px solid var(--line)}
a:hover{border-bottom-color:var(--accent)}
code{font-family:var(--font-label);font-size:.72em;background:var(--surface);color:var(--dim);
  padding:.18em .42em;word-break:break-word;letter-spacing:0}
pre{background:var(--surface);padding:1.2rem;overflow-x:auto;border-left:3px solid var(--line)}
pre code{background:none;padding:0;font-size:.8em}
hr{border:0;border-top:.5px solid var(--line);margin:3rem 0}
/* label helper */
.lab{font-family:var(--font-label);font-size:.62rem;font-weight:400;text-transform:uppercase;
  letter-spacing:.14em;color:var(--mut)}
/* cover: every reproduced image in the book, tiled small, with the title on a plate over its lower edge */
body{overflow-x:clip}
.cover{position:relative}
.cover-art{height:33.34vw;background:#141513 url(images/cover-mosaic.jpg) center/cover no-repeat}
/* on a wide screen the plate covers whole tiles: eight across and the last row, centred */
.cover-in{position:relative;width:66.67vw;margin:-8.334vw auto 0;background:var(--bg);
  padding:2.2rem 24px 1.3rem max(24px,calc((66.67vw - var(--maxw)) / 2 + 24px))}
.cover-in>.cover-tag,.cover-in>.cover-credit{max-width:calc(var(--maxw) - 48px)}
.cover .series{font-family:var(--font-label);font-size:.62rem;text-transform:uppercase;letter-spacing:.22em;color:var(--mut)}
.cover h1{font-size:clamp(1.7rem,5.6vw,3.2rem);text-transform:uppercase;letter-spacing:.06em;margin:.9rem 0 0;
  line-height:1.12;overflow-wrap:break-word;hyphens:none}
.cover .rule{width:40px;height:0;border-top:.75px solid var(--accent);margin:1.3rem 0}
.cover-tag{margin:0;font-size:1.14rem;color:var(--dim);font-style:italic}
.cover-credit{margin:1.1rem 0 0;font-family:var(--font-label);font-size:.54rem;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);line-height:1.7}
.cover-credit a{color:var(--mut)}
@media (max-width:1000px){
  .cover-art{background-image:url(images/cover-mosaic-8x6.jpg);height:75vw}
  .cover-in{width:auto;max-width:var(--maxw);margin:0 auto;padding:2rem 24px 1.2rem}}
@media (max-width:600px){.cover-art{background-image:url(images/cover-mosaic-6x8.jpg);height:133.34vw}}
.intro{padding:2.6rem 0 0}
.intro .tag{margin:0;font-size:1.04rem;color:var(--dim)}
.badges{display:flex;flex-wrap:wrap;gap:.9rem 1.6rem;margin-top:1.8rem}
.badge{font-family:var(--font-label);font-size:.62rem;text-transform:uppercase;letter-spacing:.12em;color:var(--mut)}
/* contents, each part with its first image */
.toc{margin:3rem 0 1rem}
.toc h2{font-family:var(--font-label);font-size:.62rem;font-weight:400;text-transform:uppercase;
  letter-spacing:.2em;color:var(--accent);margin:0 0 1rem}
.toc ul{list-style:none;margin:0;padding:0}
.toc li{border-bottom:.5px solid var(--line2)}
.toc a{display:grid;grid-template-columns:5.2rem 2.2rem 1fr;gap:.12rem 1rem;align-items:start;padding:1rem .1rem;border:0;color:inherit}
.toc a:hover .toc-t{color:var(--accent)}
.toc-img{grid-row:1/4;width:5.2rem;height:5.2rem;overflow:hidden;background:var(--surface);display:block}
.toc-img img{width:100%;height:100%;object-fit:cover;display:block}
.toc-dg{background:var(--panel);box-shadow:inset 0 0 0 .5px var(--line)}
.toc-dg img{object-fit:contain;padding:4px}
.toc-n{font-family:var(--font-label);font-size:.66rem;color:var(--accent);grid-row:1/4;padding-top:.42rem;letter-spacing:.06em}
.toc-t{font-family:var(--font-head);font-size:1.2rem;color:var(--ink);line-height:1.25}
.toc-s{color:var(--mut);font-size:.9rem;grid-column:3;font-style:italic}
.toc-c{grid-column:3;font-family:var(--font-label);font-size:.56rem;text-transform:uppercase;letter-spacing:.1em;color:var(--mut);margin-top:.2rem}
/* parts */
.item{padding:3.4rem 0 1.4rem;border-top:.5px solid var(--line)}
.item-kicker{font-family:var(--font-label);font-size:.62rem;text-transform:uppercase;letter-spacing:.16em;color:var(--accent)}
.item-title{font-size:clamp(1.35rem,4.6vw,2.2rem);text-transform:uppercase;letter-spacing:.05em;margin:.9rem 0 .5rem;overflow-wrap:break-word}
.item-sub{color:var(--mut);font-size:.98rem;margin:0;font-style:italic}
.item-h .sec-audio{margin-top:1rem}
.item-h .play-row{margin:.6rem 0 0}
/* the gallery: a strip across the page, first image aligned with the text */
.gallery{width:100vw;margin:1.8rem 0 0 calc(50% - 50vw)}
.gal-head{max-width:var(--maxw);margin:0 auto;padding:0 24px .6rem;display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;
  font-family:var(--font-label);font-size:.58rem;text-transform:uppercase;letter-spacing:.14em;color:var(--mut)}
.gal-head span:first-child{color:var(--accent)}
.gal-strip{display:flex;gap:6px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x proximity;
  padding:0 max(24px,calc(50vw - 22rem + 24px)) 10px;scroll-padding-left:max(24px,calc(50vw - 22rem + 24px));
  scrollbar-width:thin;scrollbar-color:var(--line) transparent}
.gal-tile{flex:none;height:156px;scroll-snap-align:start;border:0;display:block;background:var(--surface);transition:opacity .15s}
.gal-tile img{height:156px;width:auto;display:block}
.gal-tile:hover{opacity:.82}
.gal-d{background:var(--panel);box-shadow:inset 0 0 0 .5px var(--line)}
.gal-d img{padding:9px 10px}
/* the chapter opens and closes here */
.item-d{margin-top:1.6rem}
.item-s{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:.5rem 1rem;flex-wrap:wrap;
  padding:1rem 1.1rem;border:.5px solid var(--line);-webkit-tap-highlight-color:transparent}
.item-s::-webkit-details-marker{display:none}
.item-s:hover{border-color:var(--accent)}
.rd{font-family:var(--font-label);font-size:.68rem;text-transform:uppercase;letter-spacing:.16em;color:var(--accent)}
.rd::after{content:"  +";color:var(--mut)}
.item-d[open]>.item-s .rd::after{content:"  \\2013"}
.rd-close,.item-d[open]>.item-s .rd-open{display:none}
.item-d[open]>.item-s .rd-close{display:inline}
.rd-meta{font-family:var(--font-label);font-size:.56rem;text-transform:uppercase;letter-spacing:.1em;color:var(--mut)}
.item-body{padding:0 0 1.4rem;overflow-wrap:break-word}   /* long addresses in the bibliographies break rather than widen the page */
.item-close{display:block;margin:2.6rem 0 0;background:none;border:.5px solid var(--line);color:var(--mut);cursor:pointer;
  font-family:var(--font-label);font-size:.62rem;text-transform:uppercase;letter-spacing:.14em;padding:.95em 1.2em}
.item-close:hover{border-color:var(--accent);color:var(--accent)}
/* the story, and the images set beside it */
.story{padding-top:2.4rem}
.story>p{font-size:1.1rem;line-height:1.72;color:var(--ink);margin:0 0 1.4rem}
.story>p:first-child::first-letter{float:left;font-size:4.1em;line-height:.82;margin:.06em .1em 0 0;color:var(--accent);font-weight:300}
.plates{margin:2.2rem 0 2.6rem;display:grid;gap:12px}
.plates.n2,.plates.n4{grid-template-columns:1fr 1fr}
.plates.n3{grid-template-columns:1fr 1fr}
.plates.n3 .plate:first-child{grid-column:1/-1}
.plate{margin:0;min-width:0}
.plate-img{display:block;border:0;background:var(--surface)}
.plate img{display:block;width:100%;height:auto}
.plates.n2 .plate-img img,.plates.n4 .plate-img img,.plates.n3 .plate:not(:first-child) .plate-img img{aspect-ratio:4/3;object-fit:cover}
.plates.n1:not(.dg) .plate-img{background:none}
.plates.n1:not(.dg) .plate-img img{width:auto;max-width:100%;max-height:78vh;margin:0 auto}
.plates.dg .plate-img{background:none}
.plate figcaption{margin-top:.55rem;font-size:.9rem;line-height:1.4;color:var(--dim)}
.pl-num{font-family:var(--font-label);font-size:.56rem;text-transform:uppercase;letter-spacing:.12em;color:var(--accent);margin-right:.35em}
.pl-cr{display:block;margin-top:.2rem;font-size:.8rem;color:var(--mut)}
.pl-cr a{color:var(--mut)}
.pl-cr a:hover{color:var(--accent)}
@media (min-width:1180px){.plates.n1:not(.dg),.plates.n2,.plates.n3,.plates.n4{width:56rem;margin-left:-6rem}}
/* the book's own diagrams are drawn for the dark page; on the light page their colours are turned over */
@media (prefers-color-scheme:light){img.dgm{filter:invert(1) hue-rotate(180deg)}}
/* the evidence, folded */
.evidence{margin:4.2rem 0 0;padding-top:2rem;border-top:.75px solid var(--accent)}
.ev-head h3{font-family:var(--font-label);font-size:.72rem;font-weight:400;text-transform:uppercase;letter-spacing:.2em;color:var(--accent);margin:0 0 .8rem}
.ev-head p{margin:0 0 1.8rem;color:var(--mut);font-size:.98rem;font-style:italic}
.evidence .sec{margin:0}
.evidence .sec:last-of-type>details>summary{border-bottom:.5px solid var(--line)}
.evidence .sec>details[open]{padding-bottom:1.6rem}
.subtopics{margin:0 0 1.8rem}
.subtopics h4{font-family:var(--font-label);font-size:.6rem;font-weight:400;text-transform:uppercase;
  letter-spacing:.16em;color:var(--mut);margin:0 0 .8rem}
.subtopics ul{margin:0;padding:0;list-style:none}
.subtopics li{margin:.5rem 0;font-size:.98rem;color:var(--dim);padding-left:1.4rem;position:relative}
.subtopics li::before{content:"";position:absolute;left:0;top:.72em;width:.7rem;height:0;border-top:.5px solid var(--line)}
/* sections */
.sec{margin:2.8rem 0}
.sec>details>summary{cursor:pointer;list-style:none;padding:1rem 0;border-top:.5px solid var(--line);
  display:flex;justify-content:space-between;align-items:baseline;gap:1rem}
.sec>details>summary::-webkit-details-marker{display:none}
.sec>details>summary h3{font-family:var(--font-label);font-size:.66rem;font-weight:400;text-transform:uppercase;
  letter-spacing:.16em;color:var(--accent);margin:0}
.sec>details>summary::after{content:"+";font-family:var(--font-label);color:var(--mut);font-size:.8rem}
.sec>details[open]>summary::after{content:"–"}
.sec-inner{padding-top:1.2rem}
.sec-summary>h3,.sec-audio>h3{font-family:var(--font-label);font-size:.66rem;font-weight:400;text-transform:uppercase;
  letter-spacing:.16em;color:var(--accent);border-top:.5px solid var(--line);padding-top:1rem;margin:0 0 1.2rem}
.sec h4{margin:2.6rem 0 .7rem;font-size:1.22rem;color:var(--ink)}
.sec h5{margin:1.8rem 0 .5rem;font-family:var(--font-label);font-size:.66rem;font-weight:400;
  text-transform:uppercase;letter-spacing:.12em;color:var(--mut)}
.sec p{margin:0 0 1.25rem}
.sec ul{padding-left:1.3rem}
.sec li{margin:.55rem 0}
/* audio */
.audio-note{color:var(--mut);font-size:.92rem;margin:.4rem 0;font-style:italic}
.audio-missing{display:none}
.sec-audio.no-audio .play-row{display:none}
.sec-audio.no-audio .audio-missing{display:block;color:var(--mut);font-size:.88rem;font-style:italic;margin:.4rem 0}
.play-row{display:flex;align-items:center;gap:1.1rem;flex-wrap:wrap;margin:1rem 0 .3rem}
.play-btn{display:inline-flex;align-items:center;gap:.6rem;border:.5px solid var(--accent);background:none;color:var(--accent);
  font-family:var(--font-label);font-size:.66rem;text-transform:uppercase;letter-spacing:.12em;
  padding:.85em 1.3em;cursor:pointer;-webkit-tap-highlight-color:transparent}
.play-btn:hover,.play-btn.is-playing{background:var(--accent);color:var(--bg)}
.play-btn .pi{width:0;height:0;border-style:solid;border-width:4px 0 4px 7px;border-color:transparent transparent transparent currentColor}
.play-btn.playing .pi{width:7px;height:9px;border:0;border-left:2px solid currentColor;border-right:2px solid currentColor}
.play-dur,.play-pos{font-family:var(--font-label);font-size:.6rem;text-transform:uppercase;letter-spacing:.1em;color:var(--mut)}
.play-pos:not(:empty)::before{content:"/ "}
.listen-all{display:flex;align-items:center;gap:1.4rem;flex-wrap:wrap;margin:0 0 .4rem;
  padding:1.8rem 0;border-bottom:.5px solid var(--line)}
.listen-btn{display:inline-flex;align-items:center;gap:.7rem;border:.5px solid var(--accent);background:none;color:var(--accent);
  font-family:var(--font-label);font-size:.68rem;text-transform:uppercase;letter-spacing:.14em;padding:1em 1.6em;cursor:pointer}
.listen-btn:hover{background:var(--accent);color:var(--bg)}
.listen-btn .pi{width:0;height:0;border-style:solid;border-width:5px 0 5px 8px;border-color:transparent transparent transparent currentColor}
.listen-note{color:var(--mut);font-size:.88rem;flex:1 1 15rem;font-style:italic}
.transcript{margin-top:1.4rem;border-top:.5px solid var(--line2);padding-top:1rem}
.transcript>summary{cursor:pointer;font-family:var(--font-label);font-size:.64rem;text-transform:uppercase;
  letter-spacing:.12em;color:var(--accent);padding:.5rem 0;list-style:none}
.transcript>summary::-webkit-details-marker{display:none}
.transcript p{font-size:1.06rem}
/* sticky player */
body.has-player{padding-bottom:6rem}
.player{position:fixed;left:0;right:0;bottom:0;z-index:50;background:var(--panel);border-top:.5px solid var(--line);
  padding-bottom:env(safe-area-inset-bottom)}
.player-in{max-width:var(--maxw);margin:0 auto;display:flex;align-items:center;gap:1rem;padding:.9rem 24px}
.p-btn{border:.5px solid var(--line);background:none;color:var(--dim);cursor:pointer;
  font-family:var(--font-label);font-size:.6rem;letter-spacing:.06em;min-width:2.5rem;height:2.5rem;
  display:inline-flex;align-items:center;justify-content:center;gap:.1rem;padding:0 .45rem;-webkit-tap-highlight-color:transparent}
.p-btn:hover{border-color:var(--accent);color:var(--accent)}
.p-sub{font-size:.9em;opacity:.7}
.p-main{border-color:var(--accent);color:var(--accent);min-width:2.9rem;height:2.9rem;flex:none}
.p-main .pi{width:0;height:0;border-style:solid;border-width:5px 0 5px 9px;border-color:transparent transparent transparent currentColor;margin-left:2px}
.player.playing .p-main .pi{width:8px;height:11px;border:0;border-left:2px solid currentColor;border-right:2px solid currentColor;margin:0}
.p-mid{flex:1;min-width:0}
.p-title{font-family:var(--font-label);font-size:.62rem;text-transform:uppercase;letter-spacing:.1em;
  color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p-bar{margin-top:.3rem}
#pSeek{width:100%;-webkit-appearance:none;appearance:none;background:none;height:1rem;cursor:pointer}
#pSeek::-webkit-slider-runnable-track{height:1px;background:var(--line)}
#pSeek::-moz-range-track{height:1px;background:var(--line)}
#pSeek::-webkit-slider-thumb{-webkit-appearance:none;width:9px;height:9px;background:var(--accent);margin-top:-4px}
#pSeek::-moz-range-thumb{width:9px;height:9px;border:0;background:var(--accent)}
.p-times{display:flex;justify-content:space-between;font-family:var(--font-label);font-size:.55rem;
  letter-spacing:.08em;color:var(--mut);margin-top:.1rem}
.p-right{display:flex;gap:.35rem;flex:none}
/* marks */
.mk{font-family:var(--font-label);font-size:.56rem;text-transform:uppercase;letter-spacing:.1em;
  padding:.3em .5em;vertical-align:.1em;background:var(--surface);
  /* long marks wrap with the text instead of pushing the page sideways on a phone */
  overflow-wrap:anywhere;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.mk-v{color:var(--ok)}
.mk-n{color:var(--mut)}
.mk-u{color:var(--hot);box-shadow:inset 0 0 0 .5px currentColor}
.mk-u-plain{color:var(--mut);font-style:italic;background:none;font-family:var(--font-body);
  font-size:.92em;text-transform:none;letter-spacing:0;padding:0}
.grade{display:inline-flex;flex-wrap:wrap;max-width:100%;font-family:var(--font-label);font-size:.55rem;text-transform:uppercase;
  letter-spacing:.09em;vertical-align:.12em;margin:0 .12em;border:.5px solid var(--line)}
.grade>span{overflow-wrap:anywhere;min-width:0}
.grade .g0{color:var(--mut);padding:.32em .45em;font-style:italic;border-right:.5px solid var(--line)}
.grade .g1{color:var(--accent);padding:.32em .45em}
.grade .g2{color:var(--dim);padding:.32em .45em;border-left:.5px solid var(--line)}
.grade .g3{color:var(--hot);padding:.32em .45em;border-left:.5px solid var(--line)}
.grade-note{color:var(--mut);font-size:.93em;font-style:italic}
/* figures */
.fig{margin:2.8rem 0;padding:0}
.fig-head{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;
  font-family:var(--font-label);font-size:.6rem;text-transform:uppercase;letter-spacing:.14em;
  border-top:.5px solid var(--line);padding-top:.8rem}
.fig-num{color:var(--accent)}
.fig-status{color:var(--mut)}
.fig-title{font-family:var(--font-head);font-size:1.16rem;color:var(--ink);margin:.7rem 0 1.1rem}
.fig svg,.fig img{width:100%;height:auto;display:block;margin:0 0 1rem}
.fig-placeholder{border:.5px dashed var(--line);min-height:7rem;display:grid;place-items:center;padding:1.6rem;margin-bottom:1rem}
.fig-ph-label{font-family:var(--font-label);font-size:.6rem;text-transform:uppercase;letter-spacing:.12em;color:var(--mut);text-align:center}
.fig figcaption{margin:0 0 1rem;font-size:.97rem;color:var(--dim)}
.fig figcaption strong{font-family:var(--font-label);font-size:.6rem;text-transform:uppercase;
  letter-spacing:.12em;color:var(--mut);font-weight:400}
.fig-meta{display:grid;grid-template-columns:5.6rem 1fr;gap:.35rem 1rem;margin:0;
  font-family:var(--font-label);font-size:.58rem;letter-spacing:.06em;color:var(--mut)}
.fig-meta dt{text-transform:uppercase}
.fig-meta dd{margin:0;word-break:break-word;font-family:var(--font-body);font-size:.88rem;letter-spacing:0}
/* footer */
.foot{margin-top:4rem;padding-top:1.6rem;border-top:.5px solid var(--line);color:var(--mut);font-size:.88rem}
.foot p{margin:0 0 .9rem}
/* the image viewer: always dark, in both themes, so photographs and the book's diagrams read the same */
.lb{position:fixed;inset:0;z-index:90;background:#0B0B0A;display:flex;align-items:center;justify-content:center;
  padding:4rem 4.4rem 1.4rem;overscroll-behavior:contain}
.lb[hidden]{display:none}
.lb-fig{margin:0;display:flex;flex-direction:column;align-items:center;max-width:100%;max-height:100%}
.lb-fig img{display:block;background:#141513}
.lb-cap{width:100%;max-width:46rem;margin-top:1rem;color:#B8B5AC;font-size:.95rem;line-height:1.45;overflow-y:auto;max-height:11rem}
.lb-num{font-family:var(--font-label);font-size:.58rem;text-transform:uppercase;letter-spacing:.14em;color:#6A9CC4}
.lb-t{font-family:var(--font-head);font-size:1.3rem;color:#F4F2EC;margin:.25rem 0 .3rem;line-height:1.25}
.lb-s{color:#B8B5AC;font-style:italic;margin:0 0 .4rem}
.lb-cr{font-size:.84rem;color:#8A8880}
.lb-cr a,.lb-go{color:#6A9CC4;border-bottom-color:#32352F}
.lb-go{display:inline-block;margin-top:.5rem;font-family:var(--font-label);font-size:.58rem;text-transform:uppercase;letter-spacing:.12em}
.lb-btn{position:absolute;width:2.9rem;height:2.9rem;border:.5px solid #32352F;background:rgba(20,21,19,.6);color:#ECEAE3;cursor:pointer;
  font-family:var(--font-label);font-size:1rem;line-height:1;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}
.lb-btn:hover{border-color:#6A9CC4;color:#6A9CC4}
.lb-x{top:.9rem;right:.9rem}
.lb-prev{left:.9rem;top:50%;margin-top:-1.45rem}
.lb-next{right:.9rem;top:50%;margin-top:-1.45rem}
html.lb-on{overflow:hidden}
@media (max-width:700px){
  .lb{padding:4rem .8rem 1rem}
  .lb-prev,.lb-next{top:.9rem;margin-top:0}
  .lb-prev{left:.9rem}.lb-next{left:4.2rem;right:auto}
  .lb-cap{max-height:34vh}
}
@media (max-width:520px){
  body{font-size:17.5px}.wrap{padding:0 18px 5rem}
  .cover-in{padding:1.6rem 18px 1rem}
  .cover h1{letter-spacing:.03em}
  .gal-head{padding:0 18px .55rem}
  .gal-strip{padding:0 18px 10px;scroll-padding-left:18px;gap:5px}
  .gal-tile,.gal-tile img{height:118px}
  .toc a{grid-template-columns:4rem 1.9rem 1fr;gap:.1rem .75rem}
  .toc-img{width:4rem;height:4rem}
  .toc-t{font-size:1.1rem}
  .story>p{font-size:1.07rem}
  .plates{gap:8px}
  .fig-meta{grid-template-columns:1fr;gap:.1rem}
  .fig-meta dt{margin-top:.5rem}
  .player-in{gap:.5rem;padding:.8rem 14px}
  .p-right #pBack{display:none}
  .p-btn{min-width:2.2rem;height:2.2rem;padding:0 .32rem}
  .p-main{min-width:2.6rem;height:2.6rem}
}
@media print{.item-d,.sec>details,.transcript{display:block}details>summary{display:none}
  .sec-audio,.listen-all,.player,.gallery,.lb,.item-close{display:none}body{font-size:10.5pt;color:#1A1A1A}.wrap{padding:0}
  .cover-art{display:none}.cover-in{margin:0}}
</style>
</head>
<body>
<header class="cover">
  <div class="cover-art" role="img" aria-label="The book’s ${figStats.placed} reproduced images, tiled small"></div>
  <div class="cover-in">
    <div class="series">${esc(M.series)}</div>
    <h1>${esc(M.book_name).replace(/\+/g, '+<wbr>')}</h1>
    <div class="rule"></div>
    <p class="cover-tag">How nature has been brought into, around and to the threshold of buildings — and who measured any of it.</p>
    <p class="cover-credit">Cover: the book’s ${figStats.placed} reproduced images, tiled — each is credited beside its figure and in <a href="${CREDITS_URL}" rel="noopener">the image credits</a>; the mosaic is shared under <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license noopener">CC BY-SA 4.0</a>.</p>
  </div>
</header>
<div class="wrap">
<section class="intro">
  <p class="tag">A compiled, graded and cited account of how nature has been brought into, around and to the threshold of buildings — from the first painted caves to materials now being grown. Each chapter opens on its images and a story you can read or listen to. Folded beneath it lies the evidence the story is told from: every claim carries two grades, conflicts stand side by side, and gaps are findings. Beneath that history runs a second one, of what was ever measured and who is allowed to read the numbers; it is gathered after the eighth chapter.</p>
  <div class="badges">
    <span class="badge">${built.filter(b => b.c.editions.includes(edition) && b.c.kind !== 'section').length} chapters · ${built.filter(b => b.c.editions.includes(edition) && b.c.kind === 'section').length} closing sections</span>
    <span class="badge">${Math.round(publishedWords / 1000)}k words</span>
    <span class="badge">${Math.round(built.reduce((a, b) => a + b.mins, 0) / 60 * 10) / 10} h narration</span>
    <span class="badge">${figStats.placed} photographs</span>
    <span class="badge">${figStats.made} diagrams</span>
    <span class="badge">poured ${esc(String(M.manifest_date))}</span>
  </div>
</section>
<div class="listen-all" id="listenAll">
  <button class="listen-btn" type="button" id="playAll"><span class="pi"></span><span>Listen to the whole book</span></button>
  <span class="listen-note">${Math.round(built.reduce((a, b) => a + b.mins, 0) / 60 * 10) / 10} hours, ${built.length} parts — plays straight through and remembers where you stopped.</span>
</div>
<nav class="toc"><h2>Contents</h2><ul>${toc.join('')}</ul></nav>
${parts.join('\n')}
<footer class="foot">
  <p>${esc(M.book_name)} · ${esc(M.series)} · built ${esc(String(M.manifest_date))} from <code>NATURE_ARCHITECTURE_MANIFEST_v1.md</code>. Licensed CC BY 4.0.</p>
  <p>Source marks: <span class="mk mk-v">verified</span> the source was opened and the claim confirmed · <span class="mk mk-n">not opened</span> cited from a record or through another source${UNFILLED_PLAIN ? ' · <span class="mk mk-u-plain">unfilled</span> a figure the research could not reach and did not supply from memory, left unfilled rather than guessed' : ' · <span class="mk mk-u">unfilled — lane X</span> a figure the research could not reach'}. Grades: <span class="grade"><span class="g1">RESEARCH FINDING</span><span class="g2">MEASURED</span></span> — first what kind of statement, then where the number came from.</p>
  <p>Published in full. The author's own product-mapping notes and the questions collected for his design board are held separately and are not part of this book.</p>
</footer>
</div>

<div class="player" id="player" hidden>
  <div class="player-in">
    <button class="p-btn p-main" type="button" id="pPlay" aria-label="Play or pause"><span class="pi"></span></button>
    <div class="p-mid">
      <div class="p-title" id="pTitle"></div>
      <div class="p-bar"><input type="range" id="pSeek" min="0" max="1000" value="0" step="1" aria-label="Seek"><div class="p-times"><span id="pNow">0:00</span><span id="pEnd">0:00</span></div></div>
    </div>
    <div class="p-right">
      <button class="p-btn" type="button" id="pBack" aria-label="Back 15 seconds">15<span class="p-sub">&#8630;</span></button>
      <button class="p-btn" type="button" id="pFwd" aria-label="Forward 30 seconds">30<span class="p-sub">&#8631;</span></button>
      <button class="p-btn p-rate" type="button" id="pRate" aria-label="Playback speed">1&#215;</button>
      <button class="p-btn" type="button" id="pClose" aria-label="Close player">&#215;</button>
    </div>
  </div>
</div>

<div class="lb" id="lb" hidden role="dialog" aria-modal="true" aria-label="Image viewer">
  <button class="lb-btn lb-x" type="button" id="lbX" aria-label="Close the viewer">&#215;</button>
  <button class="lb-btn lb-prev" type="button" id="lbPrev" aria-label="Previous image">&#8249;</button>
  <button class="lb-btn lb-next" type="button" id="lbNext" aria-label="Next image">&#8250;</button>
  <figure class="lb-fig">
    <img id="lbImg" alt="">
    <figcaption class="lb-cap">
      <div class="lb-num" id="lbNum"></div>
      <div class="lb-t" id="lbT"></div>
      <p class="lb-s" id="lbS"></p>
      <div class="lb-cr" id="lbCr"></div>
      <a class="lb-go" id="lbGo" href="#">See it among the evidence, with its source</a>
    </figcaption>
  </figure>
</div>
<script>
(function(){
  var TRACKS = ${JSON.stringify(built.filter(b => b.c.editions.includes(edition)).map(b => ({ id: b.c.id, title: (b.c.kind === 'section' ? b.c.title : parseInt(b.c.id, 10) + ' · ' + b.c.title), src: 'audio/' + b.audioSlug + '.mp3' })))};
  var a = new Audio(); a.preload = 'none';
  var el = function(i){ return document.getElementById(i); };
  var player = el('player'), idx = -1, rates = [1, 1.25, 1.5, 1.75, 2], ri = 0, seeking = false;
  var dead = {};                                  // tracks whose file is missing

  function store(k, v){ try { localStorage.setItem('nab:' + k, v); } catch(e){} }
  function recall(k){ try { return localStorage.getItem('nab:' + k); } catch(e){ return null; } }
  function fmt(t){ if(!isFinite(t)) return '0:00'; t = Math.floor(t);
    var h = Math.floor(t/3600), m = Math.floor((t%3600)/60), s = t%60;
    return (h ? h + ':' + String(m).padStart(2,'0') : m) + ':' + String(s).padStart(2,'0'); }

  function markDead(id){
    dead[id] = true;
    var sec = document.querySelector('.sec-audio[data-track="' + id + '"]');
    if (sec) sec.classList.add('no-audio');
  }
  function refreshPositions(){
    TRACKS.forEach(function(t){
      var p = parseFloat(recall('pos:' + t.id) || 0), d = parseFloat(recall('dur:' + t.id) || 0);
      var n = document.querySelector('[data-pos="' + t.id + '"]');
      if (n && p > 30 && d) n.textContent = (p / d > 0.97) ? 'finished' : 'stopped at ' + fmt(p);
    });
  }
  function load(i, auto){
    if (i < 0 || i >= TRACKS.length) { a.pause(); return; }
    idx = i; var t = TRACKS[i];
    a.src = t.src; a.playbackRate = rates[ri];
    var p = parseFloat(recall('pos:' + t.id) || 0);
    if (p > 5) a.currentTime = p;
    el('pTitle').textContent = t.title;
    player.hidden = false;
    document.body.classList.add('has-player');
    document.querySelectorAll('.play-btn').forEach(function(b){ b.classList.toggle('is-playing', b.dataset.play === t.id); });
    if (auto !== false) a.play().catch(function(){});
  }
  function next(){
    var i = idx + 1;
    while (i < TRACKS.length && dead[TRACKS[i].id]) i++;
    if (i < TRACKS.length) load(i); else { a.pause(); setIcon(false); }
  }
  function setIcon(playing){
    player.classList.toggle('playing', playing);
    document.querySelectorAll('.play-btn.is-playing').forEach(function(b){ b.classList.toggle('playing', playing); });
  }

  a.addEventListener('error', function(){ if (idx > -1) { markDead(TRACKS[idx].id); var was = idx; a.pause(); setIcon(false);
    if (player.dataset.mode === 'all') { idx = was; next(); } } });
  a.addEventListener('play',  function(){ setIcon(true); });
  a.addEventListener('pause', function(){ setIcon(false); });
  a.addEventListener('ended', function(){ if (idx > -1) store('pos:' + TRACKS[idx].id, 0); next(); });
  a.addEventListener('loadedmetadata', function(){ el('pEnd').textContent = fmt(a.duration); if (idx > -1) store('dur:' + TRACKS[idx].id, a.duration); });
  a.addEventListener('timeupdate', function(){
    if (seeking || !isFinite(a.duration)) return;
    el('pNow').textContent = fmt(a.currentTime);
    el('pSeek').value = Math.round(a.currentTime / a.duration * 1000);
    if (idx > -1 && Math.floor(a.currentTime) % 5 === 0) { store('pos:' + TRACKS[idx].id, a.currentTime); refreshPositions(); }
  });

  el('pPlay').addEventListener('click', function(){ if (a.paused) a.play().catch(function(){}); else a.pause(); });
  el('pBack').addEventListener('click', function(){ a.currentTime = Math.max(0, a.currentTime - 15); });
  el('pFwd').addEventListener('click',  function(){ a.currentTime = Math.min(a.duration || 0, a.currentTime + 30); });
  el('pRate').addEventListener('click', function(){ ri = (ri + 1) % rates.length; a.playbackRate = rates[ri]; this.textContent = rates[ri] + '\u00D7'; });
  el('pClose').addEventListener('click', function(){ a.pause(); player.hidden = true; document.body.classList.remove('has-player');
    document.querySelectorAll('.play-btn').forEach(function(b){ b.classList.remove('is-playing','playing'); }); });
  var seek = el('pSeek');
  seek.addEventListener('input', function(){ seeking = true; el('pNow').textContent = fmt(this.value / 1000 * (a.duration || 0)); });
  seek.addEventListener('change', function(){ if (isFinite(a.duration)) a.currentTime = this.value / 1000 * a.duration; seeking = false; });

  document.querySelectorAll('.play-btn').forEach(function(b){
    b.addEventListener('click', function(){
      var id = this.dataset.play, i = TRACKS.findIndex(function(t){ return t.id === id; });
      player.dataset.mode = 'one';
      if (idx === i && !a.paused) { a.pause(); return; }
      if (idx === i) { a.play().catch(function(){}); return; }
      load(i);
    });
  });
  el('playAll').addEventListener('click', function(){
    player.dataset.mode = 'all';
    var i = 0; while (i < TRACKS.length && dead[TRACKS[i].id]) i++;
    if (idx === -1) load(i); else if (a.paused) a.play().catch(function(){}); else a.pause();
  });

  // Probe each file once. The recordings are added after the book is built, so availability is
  // decided here at run time — not when the page was poured. A chapter whose file is not there yet
  // says so and play-all steps over it; nothing needs rebuilding when the files land.
  var checked = 0, alive = 0;
  TRACKS.forEach(function(t){
    fetch(t.src, { method: 'HEAD' })
      .then(function(r){ if (r.ok) alive++; else markDead(t.id); })
      .catch(function(){ markDead(t.id); })
      .then(function(){
        if (++checked === TRACKS.length) {
          var la = el('listenAll');
          if (!alive && la) {
            la.querySelector('#playAll').disabled = true;
            la.querySelector('.listen-note').textContent =
              'The narration has not been added yet. What it reads is on the page: each part\u2019s story.';
          } else if (la && alive < TRACKS.length) {
            la.querySelector('.listen-note').textContent =
              alive + ' of ' + TRACKS.length + ' parts recorded so far \u2014 plays straight through and remembers where you stopped.';
          }
        }
      });
  });
  refreshPositions();
})();
</script>
<script>
(function(){
  // The image viewer, and opening whatever a link points into.
  var IMGS = ${J(viewer)};
  var SETS = ${J(sets)};
  var el = function(i){ return document.getElementById(i); };
  var lb = el('lb'), img = el('lbImg'), cur = null, back = null, tx = null;
  function h(s){ return String(s).replace(/[&<>"]/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fit(){
    if (!cur) return;
    var e = IMGS[cur], small = window.innerWidth <= 700;
    var aw = window.innerWidth - (small ? 16 : 150);
    var ah = window.innerHeight - (small ? 72 + Math.min(window.innerHeight * 0.34, 230) : 72 + 190);
    var s = Math.max(0.1, Math.min(aw / e.w, ah / e.h, e.k === 'd' ? 2 : 1));
    img.style.width = Math.round(e.w * s) + 'px'; img.style.height = Math.round(e.h * s) + 'px';
  }
  function show(key){
    var e = IMGS[key]; if (!e) return; cur = key;
    var set = SETS[e.set] || [key], i = set.indexOf(key);
    img.src = e.src; img.alt = e.a;
    el('lbNum').textContent = 'Fig ' + key + '  ·  ' + (i + 1) + ' of ' + set.length;
    el('lbT').textContent = e.t;
    el('lbS').textContent = e.s; el('lbS').hidden = !e.s;
    el('lbCr').innerHTML = e.k === 'p'
      ? h(e.c) + (e.d ? ' · ' + h(e.d) : '') + ' · ' + (e.lu ? '<a href="' + h(e.lu) + '" rel="license noopener">' + h(e.l) + '</a>' : h(e.l))
        + ' · <a href="' + h(e.u) + '" rel="noopener">source</a>' + (e.x ? ' · ' + h(e.x) : '')
      : 'An original diagram, drawn for this edition from the chapter’s graded text, and reusable under the book’s licence.';
    el('lbGo').setAttribute('href', '#fig-' + key.replace(/\\./g, '-'));
    el('lbPrev').hidden = el('lbNext').hidden = set.length < 2;
    fit();
  }
  function open(key){ back = document.activeElement; lb.hidden = false; document.documentElement.classList.add('lb-on'); show(key); el('lbX').focus(); }
  function close(keepFocus){ lb.hidden = true; document.documentElement.classList.remove('lb-on'); img.removeAttribute('src'); cur = null;
    if (!keepFocus && back && back.focus) back.focus({ preventScroll: true }); }
  function step(d){ if (!cur) return; var set = SETS[IMGS[cur].set] || [cur], i = set.indexOf(cur); show(set[(i + d + set.length) % set.length]); }
  function openFor(hash){
    if (!hash || hash.length < 2) return;
    var t = document.getElementById(decodeURIComponent(hash.slice(1))); if (!t) return;
    for (var n = t; n; n = n.parentElement) if (n.tagName === 'DETAILS') n.open = true;
    if (t.classList.contains('item')) { var d = t.querySelector('.item-d'); if (d) d.open = true; }
    requestAnimationFrame(function(){ t.scrollIntoView({ block: 'start' }); });
  }
  document.addEventListener('click', function(ev){
    var a = ev.target.closest ? ev.target.closest('[data-lb], a[href^="#"]') : null;
    if (!a) return;
    if (a.hasAttribute('data-lb')) { if (IMGS[a.getAttribute('data-lb')]) { ev.preventDefault(); open(a.getAttribute('data-lb')); } return; }
    var href = a.getAttribute('href');
    if (href.length > 1 && document.getElementById(decodeURIComponent(href.slice(1)))) {
      ev.preventDefault();
      if (a.id === 'lbGo') close(true);
      if (location.hash !== href) history.pushState(null, '', href);
      openFor(href);
    }
  });
  el('lbX').addEventListener('click', function(){ close(); });
  el('lbPrev').addEventListener('click', function(){ step(-1); });
  el('lbNext').addEventListener('click', function(){ step(1); });
  lb.addEventListener('click', function(ev){ if (ev.target === lb) close(); });
  document.addEventListener('keydown', function(ev){
    if (lb.hidden) return;
    if (ev.key === 'Escape') close(); else if (ev.key === 'ArrowLeft') step(-1); else if (ev.key === 'ArrowRight') step(1);
  });
  lb.addEventListener('touchstart', function(ev){ tx = ev.touches.length === 1 ? ev.touches[0].clientX : null; }, { passive: true });
  lb.addEventListener('touchend', function(ev){ if (tx === null) return; var dx = ev.changedTouches[0].clientX - tx; tx = null; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); });
  window.addEventListener('resize', fit);
  document.querySelectorAll('[data-close]').forEach(function(b){
    b.addEventListener('click', function(){
      var art = el(this.getAttribute('data-close')); if (!art) return;
      var d = art.querySelector('.item-d'); if (d) d.open = false;
      art.scrollIntoView({ block: 'start' });
    });
  });
  window.addEventListener('hashchange', function(){ openFor(location.hash); });
  window.addEventListener('popstate', function(){ openFor(location.hash); });
  if (location.hash) openFor(location.hash);
})();
</script>
</body>
</html>`;
  return { html, figStats, publishedWords, plateStats };
}

const outputs = [];
for (const edition of M.editions) {
  const { html, figStats, publishedWords, plateStats } = renderEdition(edition);
  // acceptance check 3 — SHARE must not leak apparatus
  if (html.includes('DECISION-FOR-ARCHITECT')) fail('public output contains the string DECISION-FOR-ARCHITECT');
  if (/\bFit:/.test(html)) fail('public output contains a rulebook Fit clause');
  if (!/GENERATIVE RULEBOOK/.test(html)) fail('public output is missing the GENERATIVE RULEBOOK section');
  // File names carry no spaces: a space becomes %20 in a GitHub URL on a phone.
  const base = M.book_name.replace(/\s+/g, '_');
  const name = edition === 'SHARE' ? `${base}_SHARE.html` : 'index.html';
  fs.writeFileSync(path.join(ROOT, name), html);
  outputs.push({ edition, name, bytes: Buffer.byteLength(html), figStats, publishedWords, plateStats });
}

// the page's cover and galleries load these; they are made by tools/make_cover_and_thumbnails.py
for (const f of ['cover-mosaic.jpg', 'cover-mosaic-8x6.jpg', 'cover-mosaic-6x8.jpg'])
  if (!fs.existsSync(path.join(IMAGES, f))) fail(`images/${f} is missing — run tools/make_cover_and_thumbnails.py, then pour again.`);

/* ---------- the book's own audio manifest (house shape, as CALVEY_RESEARCH_BOOK's) ---------- */
fs.writeFileSync(path.join(AUDIO, 'manifest.json'), JSON.stringify({
  book: M.book_name,
  series: M.series,
  edition: M.editions[0],
  voice: M.audio_voice_name || 'af_bella',
  prefix: AUDIO_PREFIX,
  note: "One file per part, from that part's '## 01 · NARRATIVE' section only. The transcript beside each entry is the text of record and is byte-identical to what must be voiced.",
  files: built.map(b => ({
    id: b.audioSlug,
    chapter: b.c.id,
    title: b.c.title,
    subtitle: b.c.sources[0].subtitle || null,
    words: b.words,
    estimated_minutes: b.mins,
    transcript: `audio/${b.audioSlug}.txt`,
    path: `audio/${b.audioSlug}.mp3`
  }))
}, null, 2) + '\n');

/* ---------- orphans: transcripts or recordings that no manifest row names any more ---------- */
const named = new Set(built.flatMap(b => [`${b.audioSlug}.txt`, `${b.audioSlug}.mp3`]));
const orphans = fs.readdirSync(AUDIO).filter(f => f.startsWith(AUDIO_PREFIX) && /\.(txt|mp3)$/.test(f) && !named.has(f));
if (orphans.length) note(`audio/ holds ${orphans.length} file(s) no row names: ${orphans.join(', ')}`);

/* ---------- credits + build report ---------- */
const fetched = outputs[0].figStats;
const drawnDirs = fs.readdirSync(IMAGES, { withFileTypes: true })
  .filter(d => d.isDirectory() && fs.readdirSync(path.join(IMAGES, d.name)).some(f => f.endsWith('.svg')))
  .map(d => d.name).sort();
fs.writeFileSync(path.join(IMAGES, 'CREDITS.md'),
`# Image credits — ${M.book_name}

## Original diagrams — ${fetched.made} of ${fetched.total} figure blocks

Each is an SVG drawn for this edition from its block's own \`shows:\` specification and the
chapter's graded text, filed by chapter in ${drawnDirs.map(d => '`images/' + d + '/`').join(', ')}. They are
the book's own work and carry the book's licence (see LICENSE at the repository root). Where a diagram restates a
measured figure, its source is the one the chapter cites for that figure.

## Photographs and other reproduced images — ${fetched.placed} placed

${fetched.placed ? `Each keeps its own licence, as read at its source page and repeated beside its figure in the book;
the book's licence does not cover them. Nothing was fetched before its licence was read.

${fetched.placedList.map(p => '- `' + p.rel + '` — FIG ' + p.num + ' · ' + p.name + ' — ' + p.creator + (p.date ? ' · ' + p.date : '') + ' · ' + p.license + ' · ' + p.source + (p.changes ? ' · ' + p.changes : '')).join('\n')}
` : 'None placed yet. Nothing is fetched until its licence has been read at its source page.\n'}
${fetched.ready}${fetched.placed ? ' more' : ''} figure block${fetched.ready === 1 ? ' has its licence' : 's have their licence'} read at source and wait${fetched.ready === 1 ? 's' : ''} to be placed; ${fetched.withheld} ${fetched.withheld === 1 ? 'is' : 'are'} withheld because the licence found does not allow reuse here; ${fetched.licence} ${fetched.licence === 1 ? 'has' : 'have'} not had a licence read${fetched.drawn ? '; ' + fetched.drawn + ' original diagram' + (fetched.drawn === 1 ? ' is' : 's are') + ' still to be drawn' : ''}.

## The cover

\`images/cover-mosaic.jpg\`, \`images/cover-mosaic-8x6.jpg\` and \`images/cover-mosaic-6x8.jpg\` tile every reproduced
image listed above, each cropped square and reduced, in book order; the three differ only in how the same
tiles are arranged, for wide, middling and narrow screens. They are made by
\`tools/make_cover_and_thumbnails.py\`. Because several tiles are shared under CC BY-SA, the mosaics are
shared under CC BY-SA 4.0; each tile keeps its own licence and credit above. The same script writes the
reduced copies in \`images/thumbs/\` that the galleries and contents load; each is its original, resized.

These lines are written by the pour from each figure block (\`creator\`, \`date\`, \`license\`, \`source\`,
\`changes\`). To place an image, read its licence at the source page, record it in the block with
\`status: ready\`, and save the file at the block's \`file:\` path as .jpg or .png; then run the cover
script again and re-pour.
`);

const totalWords = built.reduce((a, b) => a + b.totalWords, 0);
const totalMins = built.reduce((a, b) => a + b.mins, 0);
const report = `# POUR REPORT — ${M.book_name}

**Poured:** ${new Date().toISOString().slice(0, 10)} · **Manifest:** v${M.version}, ${M.manifest_date} · **Script:** \`pour_nature_book.mjs\` (zero dependencies)

## Outputs
${outputs.map(o => `- \`${o.name}\` — ${o.edition} edition, ${(o.bytes / 1024 / 1024).toFixed(2)} MB`).join('\n')}
- \`audio/\` — ${built.length} narrative transcripts (\`.txt\`), ready for narration
- \`images/CREDITS.md\` — ${fetched.made} drawn diagrams and ${fetched.placed} reproduced images credited

## Items poured — ${built.length}
${built.map(b => `- **${b.c.id} · ${b.c.title}** — ${b.totalWords.toLocaleString('en-GB')} words · narrative ${b.words.toLocaleString('en-GB')} words (~${b.mins} min) · transcript hash \`${hashes[b.c.id]}\``).join('\n')}

**Totals:** ${outputs[0].publishedWords.toLocaleString('en-GB')} words published (${totalWords.toLocaleString('en-GB')} in source, before the CALVEY_FORM layer was lifted out) · ${(totalMins / 60).toFixed(1)} hours of narration · ${fetched.total} figure blocks (${fetched.made} drawn, ${fetched.placed} reproduced, ${fetched.drawn} to be drawn, ${fetched.ready} ready to place, ${fetched.withheld} withheld, ${fetched.licence} licence to confirm).

## The illustrated reading
Each part opens on a gallery of its images; its story (the narrative, which is also what the narration reads) carries the photographs it names and the diagrams it matches best, set after the paragraph concerned.
${outputs[0].plateStats.map(p => `- **${p.id}** — gallery ${p.nPhotos} photograph${p.nPhotos === 1 ? '' : 's'} and ${p.nDiagrams} diagram${p.nDiagrams === 1 ? '' : 's'}; in the story ${p.photos} photograph${p.photos === 1 ? '' : 's'} and ${p.diagrams} diagram${p.diagrams === 1 ? '' : 's'}`).join('\n')}
- **Totals** — ${outputs[0].plateStats.reduce((a, p) => a + p.photos, 0)} of ${outputs[0].plateStats.reduce((a, p) => a + p.nPhotos, 0)} photographs and ${outputs[0].plateStats.reduce((a, p) => a + p.diagrams, 0)} of ${outputs[0].plateStats.reduce((a, p) => a + p.nDiagrams, 0)} diagrams are set in the stories; every one is in its part's gallery. Pins in the manifest's \`story_plates\`: ${Object.keys(PLATES.pin || {}).length}.
- **Cover and thumbnails** — ${['cover-mosaic.jpg', 'cover-mosaic-8x6.jpg', 'cover-mosaic-6x8.jpg'].map(f => fs.existsSync(path.join(IMAGES, f)) ? '`images/' + f + '` ' + Math.round(fs.statSync(path.join(IMAGES, f)).size / 1024) + ' KB' : '`images/' + f + '` MISSING').join(' · ')} · \`images/thumbs/\` ${fs.existsSync(THUMBS) ? fs.readdirSync(THUMBS).filter(f => f.endsWith('.jpg')).length : 0} files

## Acceptance checks
1. **Audio transcript equals its narrative; no forbidden token, heading, horizontal rule or wordless paragraph** — ${problems.some(p => /forbidden|heading|horizontal rule|nothing to voice/.test(p)) ? 'FAIL' : 'pass'} (tokens checked: ${FORBIDDEN.map(t => JSON.stringify(t)).join(', ')})
2. **No image shown without a licence read at source, its creator and its source page** — ${problems.some(p => /licence has not been read at source|lacks its creator/.test(p)) ? 'FAIL' : 'pass'}; ${fetched.placed} reproduced image${fetched.placed === 1 ? '' : 's'} credited in CREDITS.md; ${fetched.made} original diagrams drawn for this edition
3. **Public output carries the rulebook, and no fit clause or decision** — ${problems.some(p => /public output/.test(p)) ? 'FAIL' : 'pass'}
4. **Re-pour changes only what changed** — transcripts are written only when their hash changes; hashes above

${problems.length ? `## Problems (${problems.length})\n${problems.map(p => `- ${p}`).join('\n')}` : '## Problems\nNone.'}

${notes.length ? `## Notes\n${notes.map(n => `- ${n}`).join('\n')}` : ''}

## What remains
- **Audio.** Each transcript in \`audio/\` is voiced to \`audio/<same name>.mp3\`. The page checks for every file when it loads and marks any part not yet recorded, so a new recording needs no re-pour.
${voiceQueue.length ? '  - **To record after this pour (' + voiceQueue.length + '):** ' + voiceQueue.map(v => '`' + v.file + '` (' + v.why + ')').join('; ') : '  - Nothing to record: no spoken words changed in this pour.'}
${orphans.length ? '  - **Orphans to remove (' + orphans.length + '):** ' + orphans.map(o => '`audio/' + o + '`').join(', ') + ' — no manifest row names ' + (orphans.length === 1 ? 'it' : 'them') + ' any more.' : ''}
- **Figures.** ${fetched.made} drawn and ${fetched.placed} reproduced, of ${fetched.total}. ${fetched.drawn ? fetched.drawn + ' original diagram' + (fetched.drawn === 1 ? '' : 's') + " still to draw (each block's \`shows:\` line is the drawing instruction); " : 'No original diagram left to draw; '}${fetched.ready} image${fetched.ready === 1 ? '' : 's'} with a licence read, waiting to be placed; ${fetched.withheld} withheld on licence; ${fetched.licence} with no licence read yet.
- **Verification pass.** Each \`[unfilled — lane X]\` mark in the sources renders in the public text as a plain *unfilled* mark; together they are the pass's target list.
`;
fs.writeFileSync(path.join(ROOT, 'POUR_REPORT.md'), report);

console.log(report);
if (problems.length) { console.error(`\n${problems.length} problem(s) — see report.`); process.exit(2); }
