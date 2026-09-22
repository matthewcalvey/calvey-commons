#!/usr/bin/env node
// pour_nature_book.mjs — CALVEY+CLAUDE NATURE+ARCHITECTURE BOOK
// Builds the INTERNAL and SHARE editions from text/ + the manifest's machine block.
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

const FIGKEYS = ['file', 'source', 'creator', 'date', 'license', 'shows', 'alt', 'status'];

function renderFigureBlock(lines, edition, figStats) {
  const fig = {}; let title = '';
  for (const l of lines) {
    if (/^FIG /.test(l)) { title = l.replace(/^FIG\s*/, ''); continue; }
    const k = l.indexOf(':');
    if (k > -1) { const key = l.slice(0, k).trim(); if (FIGKEYS.includes(key)) fig[key] = l.slice(k + 1).trim(); }
  }
  const status = (fig.status || 'to be drawn').trim();
  figStats.total++;
  if (/to be drawn/i.test(status)) figStats.drawn++;
  else if (/^ready/i.test(status)) figStats.ready++;
  else if (/licence to confirm/i.test(status)) figStats.licence++;
  const num = title.split('·')[0].trim();
  const name = title.includes('·') ? title.split('·').slice(1).join('·').trim() : title;
  const cls = /to be drawn/i.test(status) ? 'tbd' : /^ready/i.test(status) ? 'ready' : 'ltc';
  const imgPath = fig.file ? path.join(IMAGES, path.basename(path.dirname(fig.file)), path.basename(fig.file)) : null;
  const hasImage = /^ready/i.test(status) && imgPath && fs.existsSync(imgPath);
  if (/^ready/i.test(status) && !fig.license) fail(`FIG ${num}: status ready with no licence field — not rendered as an image.`);
  return `<figure class="fig ${cls}">
  <div class="fig-head"><span class="fig-num">FIG ${esc(num)}</span><span class="fig-status">${esc(status)}</span></div>
  <div class="fig-title">${inline(name, edition)}</div>
  ${hasImage ? `<img src="${esc(fig.file)}" alt="${esc(fig.alt || '')}" loading="lazy">`
    : `<div class="fig-placeholder"><span class="fig-ph-label">${/to be drawn/i.test(status) ? 'Diagram to be drawn' : 'Image withheld until its licence is read at source'}</span></div>`}
  ${fig.shows ? `<figcaption><strong>Shows.</strong> ${inline(fig.shows, edition)}</figcaption>` : ''}
  <dl class="fig-meta">
    ${fig.file ? `<dt>file</dt><dd><code>${esc(fig.file)}</code></dd>` : ''}
    ${fig.source ? `<dt>source</dt><dd>${inline(fig.source, edition)}</dd>` : ''}
    ${fig.creator ? `<dt>creator</dt><dd>${inline(fig.creator, edition)}</dd>` : ''}
    ${fig.date ? `<dt>date</dt><dd>${inline(fig.date, edition)}</dd>` : ''}
    <dt>licence</dt><dd>${fig.license ? inline(fig.license, edition) : '<em>not read at source — image not fetched</em>'}</dd>
    ${fig.alt ? `<dt>alt</dt><dd>${inline(fig.alt, edition)}</dd>` : ''}
  </dl>
</figure>`;
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
const AUDIO_PREFIX = M.audio_prefix || 'na_';

/* ---------- cut a document by the anatomy headings ---------- */
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
    return { heading: h, body: lines.slice(start + 1, end === -1 ? lines.length : end).join('\n').trim() };
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
  const audioSlug = AUDIO_PREFIX + slug(c.title);
  const transcript = narrative.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  const tPath = path.join(AUDIO, `${audioSlug}.txt`);
  const tHash = crypto.createHash('sha256').update(transcript).digest('hex');
  const prevHash = fs.existsSync(tPath) ? crypto.createHash('sha256').update(fs.readFileSync(tPath, 'utf8')).digest('hex') : null;
  if (prevHash !== tHash) fs.writeFileSync(tPath, transcript);
  else note(`row ${c.id}: narrative unchanged (dedupe by hash) — transcript not rewritten`);
  hashes[c.id] = tHash.slice(0, 12);
  const words = narrative.split(/\s+/).filter(Boolean).length;
  const mins = Math.round(words / 150);

  built.push({ c, header, sections, audioSlug, words, mins, totalWords: doc.split(/\s+/).filter(Boolean).length });
}

function renderEdition(edition) {
  const figStats = { total: 0, drawn: 0, ready: 0, licence: 0 };
  const parts = [];
  const toc = [];
  let publishedWords = 0;

  for (const b of built) {
    const { c, sections, audioSlug, words, mins, totalWords } = b;
    if (!c.editions.includes(edition)) continue;
    const id = `item-${c.id}`;
    const kind = c.kind === 'section' ? 'Section' : 'Chapter';
    const label = c.kind === 'section' ? c.title : `${parseInt(c.id, 10)} · ${c.title}`;
    toc.push(`<li><a href="#${id}"><span class="toc-n">${esc(c.id)}</span><span class="toc-t">${esc(c.title)}</span><span class="toc-s">${esc(c.sources[0].subtitle || '')}</span></a></li>`);

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

    publishedWords += [stripLines(sections[0].body, ''), sections[1].body,
      ...bodySections.map(s => stripLines(s.body, s.heading))].join(' ').split(/\s+/).filter(Boolean).length;

    const subtopics = (c.subtopics || []).map(s => `<li>${esc(s)}</li>`).join('');

    parts.push(`<article class="item" id="${id}">
  <details class="item-d"${c.kind === 'section' ? ' open' : ''}>
    <summary class="item-s">
      <span class="item-kicker">${kind} ${esc(c.id)}</span>
      <h2 class="item-title">${esc(label)}</h2>
      <span class="item-sub">${esc(c.sources[0].subtitle || '')}</span>
      <span class="item-meta"><span>${totalWords.toLocaleString('en-GB')} words</span><span>narrative ${mins} min</span></span>
    </summary>
    <div class="item-body">
      ${subtopics ? `<nav class="subtopics"><h3>In this ${kind.toLowerCase()}</h3><ul>${subtopics}</ul></nav>` : ''}

      <section class="sec sec-summary">
        <h3>${esc(ANATOMY.summary_heading.replace(/^##\s*/, ''))}</h3>
        ${mdToHtml(stripLines(sections[0].body, ''), edition, figStats)}
      </section>

      <section class="sec sec-audio" data-track="${c.id}">
        <h3>Listen</h3>
        <p class="audio-note">The narrative is the whole ${kind.toLowerCase()} written for the ear — about ${mins} minutes.</p>
        <div class="play-row">
          <button class="play-btn" type="button" data-play="${c.id}" aria-label="Play this ${kind.toLowerCase()}"><span class="pi"></span><span class="pl">Play</span></button>
          <span class="play-dur">${mins} min</span>
          <span class="play-pos" data-pos="${c.id}"></span>
        </div>
        <p class="audio-missing">No recording yet. The verbatim transcript is at <code>audio/${audioSlug}.txt</code>; the narrative is below.</p>
        <details class="transcript"><summary>Read the narrative</summary>${mdToHtml(sections[1].body, edition, figStats)}</details>
      </section>

      ${bodySections.map(s => `<section class="sec">
        <details${/GRADED BODY/.test(s.heading) ? ' open' : ''}>
          <summary><h3>${esc(s.heading.replace(/^##\s*/, ''))}</h3></summary>
          <div class="sec-inner">${mdToHtml(stripLines(s.body, s.heading), edition, figStats)}</div>
        </details>
      </section>`).join('\n')}
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
<meta name="color-scheme" content="light dark">
<meta property="og:title" content="${esc(M.book_name)}">
<meta property="og:description" content="How nature has been brought into, around and to the threshold of buildings — and who measured any of it.">
<meta property="og:type" content="book">
<style>
:root{
  --bg:#fbfaf7; --panel:#fff; --ink:#1c1c1a; --mut:#5d5c57; --line:#e2dfd6; --line2:#efece4;
  --accent:#4a6b52; --accent-soft:#eaf0ea;
  --v:#2f6b46; --v-bg:#e8f2eb; --n:#7a6a55; --n-bg:#f3ede3; --u:#8a4b2a; --u-bg:#faeae0;
  --g1:#3b4a63; --g1-bg:#e8ecf3; --g2:#5a3f6b; --g2-bg:#f0e9f4;
  --rad:10px; --maxw:46rem;
}
@media (prefers-color-scheme: dark){:root{
  --bg:#141513; --panel:#1c1e1b; --ink:#e8e6df; --mut:#a3a096; --line:#32352f; --line2:#252823;
  --accent:#8fb89a; --accent-soft:#222a24;
  --v:#8fc9a5; --v-bg:#1d2a22; --n:#c2ab89; --n-bg:#282219; --u:#e0a078; --u-bg:#2e2018;
  --g1:#a8bcdc; --g1-bg:#1d2230; --g2:#c6a8d8; --g2-bg:#261d2c;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font:400 17px/1.62 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;
  padding-env:0}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 20px 6rem;padding-left:max(20px,env(safe-area-inset-left));padding-right:max(20px,env(safe-area-inset-right))}
h1,h2,h3,h4,h5,h6{line-height:1.22;font-weight:600;letter-spacing:-.011em}
a{color:var(--accent);text-underline-offset:.18em}
code{font:500 .86em/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--line2);padding:.1em .34em;border-radius:5px;word-break:break-word}
pre{background:var(--line2);padding:1rem;border-radius:var(--rad);overflow-x:auto;border:1px solid var(--line)}
pre code{background:none;padding:0}
hr{border:0;border-top:1px solid var(--line);margin:2rem 0}
/* masthead */
.mast{padding:3.2rem 0 1.6rem;border-bottom:1px solid var(--line)}
.mast .series{font:600 .72rem/1 ui-sans-serif,system-ui,-apple-system,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.mast h1{font-size:clamp(1.8rem,6vw,2.6rem);margin:.5rem 0 .4rem}
.mast .tag{color:var(--mut);margin:0;font-size:1rem}
.badges{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:1rem}
.badge{font:600 .68rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:.42em .6em;border-radius:999px;background:var(--accent-soft);color:var(--accent);border:1px solid var(--line)}
/* contents */
.toc{margin:2rem 0 1rem}
.toc h2{font:600 .72rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);margin:0 0 .7rem}
.toc ul{list-style:none;margin:0;padding:0}
.toc li{border-bottom:1px solid var(--line2)}
.toc a{display:grid;grid-template-columns:2.4rem 1fr;gap:.1rem .7rem;padding:.72rem .2rem;text-decoration:none;color:inherit}
.toc a:hover{background:var(--accent-soft)}
.toc-n{font:600 .78rem/1.6 ui-sans-serif,system-ui,sans-serif;color:var(--mut);grid-row:1/3}
.toc-t{font-weight:600}
.toc-s{color:var(--mut);font-size:.88rem;grid-column:2}
/* items */
.item{margin:1.1rem 0}
.item-d{background:var(--panel);border:1px solid var(--line);border-radius:var(--rad);overflow:hidden}
.item-s{cursor:pointer;list-style:none;padding:1.15rem 1.15rem;display:block}
.item-s::-webkit-details-marker{display:none}
.item-s:hover{background:var(--accent-soft)}
.item-kicker{font:600 .68rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.item-title{font-size:1.24rem;margin:.34rem 0 .2rem}
.item-sub{color:var(--mut);font-size:.94rem;display:block}
.item-meta{display:flex;gap:.9rem;margin-top:.6rem;font:500 .76rem/1 ui-sans-serif,system-ui,sans-serif;color:var(--mut)}
.item-body{padding:0 1.15rem 1.4rem;border-top:1px solid var(--line2)}
.subtopics{margin:1.2rem 0;padding:1rem 1.1rem;background:var(--line2);border-radius:var(--rad)}
.subtopics h3{font:600 .7rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);margin:0 0 .6rem}
.subtopics ul{margin:0;padding-left:1.1rem}
.subtopics li{margin:.3rem 0;font-size:.95rem}
/* sections */
.sec{margin:1.6rem 0}
.sec>details>summary{cursor:pointer;list-style:none;padding:.6rem 0;border-bottom:1px solid var(--line)}
.sec>details>summary::-webkit-details-marker{display:none}
.sec>details>summary h3{display:inline;font:600 .86rem/1.4 ui-sans-serif,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}
.sec>details>summary::after{content:"＋";float:right;color:var(--mut);font-size:.9rem}
.sec>details[open]>summary::after{content:"－"}
.sec-inner{padding-top:.4rem}
.sec-summary>h3,.sec-audio>h3{font:600 .86rem/1.4 ui-sans-serif,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);border-bottom:1px solid var(--line);padding-bottom:.6rem}
.sec h4{margin:1.8rem 0 .5rem;font-size:1.04rem}
.sec h5{margin:1.4rem 0 .4rem;font-size:.97rem;color:var(--mut)}
/* audio */
.audio-note{color:var(--mut);font-size:.92rem;margin:.4rem 0}
.audio-missing{display:none;color:var(--mut);font-size:.9rem;background:var(--line2);padding:.7rem .85rem;border-radius:var(--rad);margin:.4rem 0}
.sec-audio.no-audio .play-row{display:none}
.sec-audio.no-audio .audio-missing{display:block}
.play-row{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;margin:.7rem 0 .2rem}
.play-btn{display:inline-flex;align-items:center;gap:.5rem;border:1px solid var(--accent);background:var(--accent-soft);color:var(--accent);
  font:600 .84rem/1 ui-sans-serif,system-ui,sans-serif;padding:.62em .95em;border-radius:999px;cursor:pointer;-webkit-tap-highlight-color:transparent}
.play-btn:hover{background:var(--accent);color:var(--panel)}
.play-btn .pi{width:0;height:0;border-style:solid;border-width:5px 0 5px 8px;border-color:transparent transparent transparent currentColor}
.play-btn.playing .pi{width:8px;height:10px;border:0;border-left:3px solid currentColor;border-right:3px solid currentColor;background:none}
.play-btn.is-playing{background:var(--accent);color:var(--panel)}
.play-dur,.play-pos{font:500 .8rem/1 ui-sans-serif,system-ui,sans-serif;color:var(--mut)}
.play-pos:not(:empty)::before{content:"· "}
/* listen to all */
.listen-all{display:flex;align-items:center;gap:.9rem;flex-wrap:wrap;margin:1.8rem 0 .4rem;padding:1.1rem 1.15rem;background:var(--panel);border:1px solid var(--line);border-radius:var(--rad)}
.listen-btn{display:inline-flex;align-items:center;gap:.6rem;border:0;background:var(--accent);color:var(--panel);
  font:600 .92rem/1 ui-sans-serif,system-ui,sans-serif;padding:.8em 1.2em;border-radius:999px;cursor:pointer}
.listen-btn .pi{width:0;height:0;border-style:solid;border-width:6px 0 6px 10px;border-color:transparent transparent transparent currentColor}
.listen-note{color:var(--mut);font-size:.88rem;flex:1 1 14rem}
/* sticky player */
body.has-player{padding-bottom:5.6rem}
.player{position:fixed;left:0;right:0;bottom:0;z-index:50;background:var(--panel);border-top:1px solid var(--line);
  box-shadow:0 -2px 18px rgba(0,0,0,.09);padding-bottom:env(safe-area-inset-bottom)}
.player-in{max-width:var(--maxw);margin:0 auto;display:flex;align-items:center;gap:.7rem;padding:.6rem 16px}
.p-btn{border:1px solid var(--line);background:none;color:var(--ink);border-radius:999px;cursor:pointer;
  font:600 .72rem/1 ui-sans-serif,system-ui,sans-serif;min-width:2.3rem;height:2.3rem;display:inline-flex;
  align-items:center;justify-content:center;gap:.1rem;padding:0 .4rem;-webkit-tap-highlight-color:transparent}
.p-btn:hover{border-color:var(--accent);color:var(--accent)}
.p-sub{font-size:.9em;opacity:.75}
.p-main{background:var(--accent);border-color:var(--accent);color:var(--panel);min-width:2.7rem;height:2.7rem;flex:none}
.p-main .pi{width:0;height:0;border-style:solid;border-width:6px 0 6px 10px;border-color:transparent transparent transparent currentColor;margin-left:2px}
.player.playing .p-main .pi{width:9px;height:12px;border:0;border-left:3px solid currentColor;border-right:3px solid currentColor;margin:0}
.p-mid{flex:1;min-width:0}
.p-title{font:600 .84rem/1.3 ui-sans-serif,system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.p-bar{margin-top:.15rem}
#pSeek{width:100%;-webkit-appearance:none;appearance:none;background:none;height:1.1rem;cursor:pointer}
#pSeek::-webkit-slider-runnable-track{height:3px;background:var(--line);border-radius:3px}
#pSeek::-moz-range-track{height:3px;background:var(--line);border-radius:3px}
#pSeek::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:var(--accent);margin-top:-4.5px}
#pSeek::-moz-range-thumb{width:12px;height:12px;border:0;border-radius:50%;background:var(--accent)}
.p-times{display:flex;justify-content:space-between;font:500 .68rem/1 ui-sans-serif,system-ui,sans-serif;color:var(--mut);margin-top:-.15rem}
.p-right{display:flex;gap:.3rem;flex:none}
@media (max-width:560px){.p-right #pBack{display:none}.player-in{gap:.45rem;padding:.6rem 12px}.p-btn{min-width:2.1rem;height:2.1rem;padding:0 .3rem}.p-main{min-width:2.6rem;height:2.6rem}}
.transcript{margin-top:.7rem;border-top:1px solid var(--line2);padding-top:.6rem}
.transcript>summary{cursor:pointer;font:600 .82rem/1 ui-sans-serif,system-ui,sans-serif;color:var(--accent);padding:.4rem 0}
.transcript p{font-size:1.02rem}
/* marks */
.mk{font:600 .7rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.02em;padding:.28em .45em;border-radius:5px;white-space:nowrap;vertical-align:.06em}
.mk-v{color:var(--v);background:var(--v-bg)}
.mk-n{color:var(--n);background:var(--n-bg)}
.mk-u{color:var(--u);background:var(--u-bg);box-shadow:inset 0 0 0 1px currentColor}
.mk-u-plain{color:var(--mut);font-style:italic;background:none;font-weight:500}
.grade{display:inline-flex;border-radius:5px;overflow:hidden;font:600 .68rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.03em;vertical-align:.08em;margin:0 .1em}
.grade .g1{background:var(--g1-bg);color:var(--g1);padding:.32em .45em}
.grade .g2{background:var(--g2-bg);color:var(--g2);padding:.32em .45em}
.grade .g0{background:var(--line);color:var(--mut);padding:.32em .45em;font-style:italic}
.grade .g3{background:var(--n-bg);color:var(--n);padding:.32em .45em}
.grade-note{color:var(--mut);font-size:.93em}
/* figures */
.fig{margin:1.5rem 0;padding:1rem;border:1px solid var(--line);border-radius:var(--rad);background:var(--panel)}
.fig-head{display:flex;justify-content:space-between;align-items:center;gap:.6rem;font:600 .68rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase}
.fig-num{color:var(--accent)}
.fig-status{color:var(--mut);background:var(--line2);padding:.35em .55em;border-radius:999px}
.fig-title{font-weight:600;margin:.5rem 0 .7rem}
.fig img{width:100%;height:auto;border-radius:6px;display:block}
.fig-placeholder{border:1px dashed var(--line);border-radius:6px;min-height:6.5rem;display:grid;place-items:center;background:var(--line2);padding:1rem}
.fig-ph-label{font:500 .78rem/1.4 ui-sans-serif,system-ui,sans-serif;color:var(--mut);text-align:center}
.fig figcaption{margin:.7rem 0 0;font-size:.94rem;color:var(--ink)}
.fig-meta{display:grid;grid-template-columns:5.2rem 1fr;gap:.2rem .7rem;margin:.8rem 0 0;font:.82rem/1.5 ui-sans-serif,system-ui,sans-serif;color:var(--mut)}
.fig-meta dt{font-weight:600}
.fig-meta dd{margin:0;word-break:break-word}
/* footer */
.foot{margin-top:3rem;padding-top:1.4rem;border-top:1px solid var(--line);color:var(--mut);font-size:.88rem}
@media (max-width:480px){body{font-size:16px}.wrap{padding:0 15px 5rem}.item-s{padding:1rem}.item-body{padding:0 1rem 1.2rem}.fig-meta{grid-template-columns:1fr}.fig-meta dt{margin-top:.4rem}}
@media print{.item-d,.sec>details,.transcript{display:block}details>summary{display:none}.sec-audio,.listen-all,.player{display:none}body{font-size:11pt}.item-body,.wrap{padding:0}}
</style>
</head>
<body>
<div class="wrap">
<header class="mast">
  <div class="series">${esc(M.series)}</div>
  <h1>${esc(M.book_name)}</h1>
  <p class="tag">A compiled, graded and cited account of how nature has been brought into, around and to the threshold of buildings — from the first painted caves to materials now being grown. Every claim carries two grades. Conflicts stand side by side. Gaps are findings.</p>
  <div class="badges">
    <span class="badge">${built.filter(b => b.c.editions.includes(edition)).length} items</span>
    <span class="badge">${Math.round(publishedWords / 1000)}k words</span>
    <span class="badge">${Math.round(built.filter(b => b.c.editions.includes(edition)).reduce((a, b) => a + b.mins, 0) / 60 * 10) / 10} h audio</span>
    <span class="badge">poured ${esc(String(M.manifest_date))}</span>
  </div>
</header>
<div class="listen-all">
  <button class="listen-btn" type="button" id="playAll"><span class="pi"></span><span>Listen to the whole book</span></button>
  <span class="listen-note">${Math.round(built.filter(b => b.c.editions.includes(edition)).reduce((a, b) => a + b.mins, 0) / 60 * 10) / 10} hours, ${built.filter(b => b.c.editions.includes(edition)).length} parts — plays straight through and remembers where you stopped.</span>
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

  // probe each file once so chapters with no recording say so rather than failing on click
  TRACKS.forEach(function(t){
    fetch(t.src, { method: 'HEAD' }).then(function(r){ if (!r.ok) markDead(t.id); }).catch(function(){ markDead(t.id); });
  });
  refreshPositions();
})();
</script>
</body>
</html>`;
  return { html, figStats, publishedWords };
}

const outputs = [];
for (const edition of M.editions) {
  const { html, figStats, publishedWords } = renderEdition(edition);
  // acceptance check 3 — SHARE must not leak apparatus
  if (html.includes('DECISION-FOR-ARCHITECT')) fail('public output contains the string DECISION-FOR-ARCHITECT');
  if (/\bFit:/.test(html)) fail('public output contains a rulebook Fit clause');
  if (!/GENERATIVE RULEBOOK/.test(html)) fail('public output is missing the GENERATIVE RULEBOOK section');
  // File names carry no spaces: a space becomes %20 in a GitHub URL on a phone.
  const base = M.book_name.replace(/\s+/g, '_');
  const name = edition === 'SHARE' ? `${base}_SHARE.html` : 'index.html';
  fs.writeFileSync(path.join(ROOT, name), html);
  outputs.push({ edition, name, bytes: Buffer.byteLength(html), figStats, publishedWords });
}

/* ---------- credits + build report ---------- */
const fetched = outputs[0].figStats;
fs.writeFileSync(path.join(IMAGES, 'CREDITS.md'),
`# Image credits — ${M.book_name}

No image has been fetched. Every figure block in this book is rendered from its specification in the
chapter's \`## 04 · FIGURES\` section, and the pour fetches nothing whose licence was not read at its
source page. ${fetched.drawn} of ${fetched.total} blocks are original diagrams still to be drawn;
${fetched.licence} carry \`status: licence to confirm\` and are withheld until the licence is read;
${fetched.ready} are marked ready.

When a drawing is made or an image is licensed, add it at the \`file:\` path in its block and add a
line here: path · creator · date · licence exactly as the source states it.
`);

const totalWords = built.reduce((a, b) => a + b.totalWords, 0);
const totalMins = built.reduce((a, b) => a + b.mins, 0);
const report = `# POUR REPORT — ${M.book_name}

**Poured:** ${new Date().toISOString().slice(0, 10)} · **Manifest:** v${M.version}, ${M.manifest_date} · **Script:** \`pour_nature_book.mjs\` (zero dependencies)

## Outputs
${outputs.map(o => `- \`${o.name}\` — ${o.edition} edition, ${(o.bytes / 1024 / 1024).toFixed(2)} MB`).join('\n')}
- \`audio/\` — ${built.length} narrative transcripts (\`.txt\`), ready for narration
- \`images/CREDITS.md\` — nothing fetched; see the file

## Items poured — ${built.length}
${built.map(b => `- **${b.c.id} · ${b.c.title}** — ${b.totalWords.toLocaleString('en-GB')} words · narrative ${b.words.toLocaleString('en-GB')} words (~${b.mins} min) · transcript hash \`${hashes[b.c.id]}\``).join('\n')}

**Totals:** ${outputs[0].publishedWords.toLocaleString('en-GB')} words published (${totalWords.toLocaleString('en-GB')} in source, before the CALVEY_FORM layer was lifted out) · ${(totalMins / 60).toFixed(1)} hours of narration · ${fetched.total} figure blocks (${fetched.drawn} to be drawn, ${fetched.ready} ready, ${fetched.licence} licence to confirm).

## Acceptance checks
1. **Audio transcript equals its narrative, no forbidden token, no heading** — ${problems.some(p => /forbidden|heading/.test(p)) ? 'FAIL' : 'pass'} (tokens checked: ${FORBIDDEN.map(t => JSON.stringify(t)).join(', ')})
2. **No image fetched without a licence read at source** — pass; nothing fetched, CREDITS.md written
3. **Public output carries the rulebook, and no fit clause or decision** — ${problems.some(p => /public output/.test(p)) ? 'FAIL' : 'pass'}
4. **Re-pour changes only what changed** — transcripts are written only when their hash changes; hashes above

${problems.length ? `## Problems (${problems.length})\n${problems.map(p => `- ${p}`).join('\n')}` : '## Problems\nNone.'}

${notes.length ? `## Notes\n${notes.map(n => `- ${n}`).join('\n')}` : ''}

## What remains
- **Audio.** The transcripts are in \`audio/\`. Narrate each to \`audio/<same name>.mp3\`; the players pick them up with no rebuild. Until then each player hides itself and shows the transcript.
- **Figures.** ${fetched.drawn} original diagrams to draw; each block's \`shows:\` line is the drawing instruction. Drop the file in at its \`file:\` path and re-pour.
- **Verification pass.** The \`unfilled\` marks are rendered visibly in the INTERNAL edition and are the target list.
`;
fs.writeFileSync(path.join(ROOT, 'POUR_REPORT.md'), report);

console.log(report);
if (problems.length) { console.error(`\n${problems.length} problem(s) — see report.`); process.exit(2); }
