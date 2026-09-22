# NARRATE THE NATURE AND ARCHITECTURE BOOK — a prompt for Claude Code

Paste this into Claude Code with the repository open. It does one job: turn the ten transcripts
into ten mp3 files so the book's player comes alive. It changes nothing else.

---

Narrate the ten parts of the CALVEY+CLAUDE NATURE+ARCHITECTURE BOOK.

**Where things are.** The book repository is `~/Desktop/calvey-commons`. The ten transcripts are in
`nature-and-architecture/audio/` as `na_<slug>.txt`. Alongside them is `manifest.json`, which lists
every part with its id, chapter number, title, word count, estimated minutes, transcript path and
target mp3 path. That manifest is the work order — read it first and work from it, not from a
directory listing.

**What to produce.** For each entry, an mp3 at exactly the `path` the manifest gives — same folder,
same stem as the transcript, `.mp3` instead of `.txt`. Nothing else in the repository changes.

**The voice.** `af_bella`, the same voice as the CALVEY RESEARCH BOOK, recorded in the book's own
manifest as `audio_voice_name`. The house audio lane lives at `voice/` in the private `CALVEY_`
repository and is the thing to reuse if it is reachable — check there before building anything new,
because the existing lane already has the voice, the settings and the naming convention. The
procedure it follows is written up in
`~/Desktop/CALVEY_RESEARCH_NATURE_BOOK/EXAMPLE_BOOK/RESEARCH_BOOK_AUDIO_FULL_TEXT_PROCEDURE_v1.md`
— read §05, which is the pipeline stage by stage.

**If the existing lane is not reachable**, build the minimum that produces the same result. The
engine behind `af_bella` is Kokoro-82M, which emits 24 kHz natively and has a per-pass ceiling of
about 510 tokens, so long text must be split at **sentence boundaries only** and stitched. Synthesise
to lossless WAV, stitch, then encode once to mp3 — never re-encode a lossy file. Mono is correct for
speech. Target roughly 48 kbps, which puts a 45-minute part near 16 MB and the whole book near 140 MB,
comfortably inside GitHub's 100 MB per-file limit.

**What not to do.**
- Do not edit the transcripts. They are the text of record, verified byte-identical to each part's
  `## 01 · NARRATIVE` section, and they were written to be read aloud — no headings, no bullets, no
  brackets, no URLs, no symbols. They need no normalising. If a transcript looks like it needs
  cleaning up, something is wrong upstream; stop and say so rather than editing it.
- Do not rebuild the book. `tools/pour_nature_book.mjs` does not need to run. The page probes for
  each mp3 at run time, so the players light up as soon as the files exist.
- Do not rename anything. The player resolves files by the exact names in the manifest.

**Checks before you finish.**
1. Ten mp3 files exist at the ten paths the manifest names.
2. Each one's duration is within about twenty per cent of the manifest's `estimated_minutes`, which
   is computed at 150 words per minute. A file far shorter than its estimate means the chunking
   dropped text — the most likely failure and the one to look for.
3. Nothing outside `nature-and-architecture/audio/` changed.
4. Open `nature-and-architecture/index.html` in a browser from a local server (`python3 -m http.server`;
   file:// will not do, the probe needs HTTP). The Listen to the whole book button should be live,
   each part should show a Play control, and play-all should advance from one part to the next.

**Report** the ten durations, the total, the encoder settings used, and anything that failed.

**Then** commit and push, and the live book has audio.
