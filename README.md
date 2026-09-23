# CALVEY COMMONS

Compiled, graded and cited research on architecture — published in full, in public, and free to reuse with attribution.

**Read it:** https://matthewcalvey.github.io/calvey-commons/

---

## What is here

### Nature and Architecture
*The Calvey and Claude Nature and Architecture Book* — ten parts, about 510,000 words, from the first painted caves to materials now being grown in laboratories.

It asks how nature has been brought into, around and to the threshold of buildings, on three axes — time, place with its climate, and position: outside, at the threshold, or inside. Underneath that it asks a second question, which turned out to be the harder one: for every celebrated building and tradition, did anyone ever put instruments on it, and can anyone read the result?

The answers sorted into sixteen kinds, with four more still to be numbered, and they are the book's spine. The measurement was never made. It was commissioned, came back unfavourable, and the building went up anyway. It was made and is enclosed behind a paywall. It was made, given away freely, and lost anyway when the web page that held it changed. It was made and is reachable and does not support the claim it is cited for. It was made once and nobody funded the second visit.

Two things cut across all of it. Measurement density collapses at the façade — the space between buildings is instrumented finely and the rooms people occupy are barely measured at all. And it collapses again at the person.

`nature-and-architecture/` — the book, 236 original diagrams and 46 reproduced images, each under its own licence, the narration transcripts, and the figure credits.

---

## How to read it

Open the link above on a phone or a laptop. Each part collapses and expands; the graded body, case cards, figures, rulebook and bibliography are inside each one. There is nothing to install and nothing to sign into.

**Listening.** Each part has a narration of about forty-five minutes, and there is a play-all that runs the whole book straight through and remembers where you stopped. Where a recording has not been made yet, the part says so and gives you the transcript instead.

**Reading the marks.** A claim tagged `verified` means the source was opened and the claim confirmed. `not opened` means it was cited from a bibliographic record and nothing rests on it. `unfilled` means the research could not reach a figure and did not guess one. The two-part grades say what kind of statement a claim is and where its number came from.

---

## How it was made

Forty-one parallel research lanes, each instructed to hunt the instrumented study behind every celebrated case and to report its absence as a finding. About 869,000 words of graded notes stand behind the book. The research ran without a general web search — on bibliographic APIs and direct retrieval — which is stated in each chapter, because it shaped what could be reached.

The books are written with Claude, and every chapter says so.

`tools/pour_nature_book.mjs` builds the book from a manifest and the chapter sources. It has no dependencies; run it with `node`. The chapter sources are not in this repository: they carry a layer of notes specific to a private project, which is lifted out before publication. The book itself is published whole.

---

## Citing

> Calvey, M. (2026). *The Calvey and Claude Nature and Architecture Book.* CALVEY COMMONS. https://matthewcalvey.github.io/calvey-commons/nature-and-architecture/

For a finding inside the book, cite the original study from that chapter's bibliography rather than the book. The book compiles and grades other people's research; the investigators did the work.

---

## Licence

[CC BY 4.0](LICENSE) — share and adapt freely, including commercially, with attribution.

This covers the compilation, the writing, the grading and the original diagrams. It does not cover the underlying studies, which remain the work of the investigators named in each bibliography, under whatever terms those works carry. Where a figure carries its own licence, that licence is stated in the figure's entry and in `images/CREDITS.md` and governs that figure.

---

## Corrections

If something here is wrong — a misattributed figure, a study read incorrectly, a gap that is not actually a gap — please open an issue. The book's own argument is that this field does not check itself often enough, so a correction is the most useful thing anyone can send.
