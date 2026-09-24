# CALVEY COMMONS

Compiled, graded and cited research on architecture — published in full, in public, and free to reuse with attribution.

**Read it:** https://matthewcalvey.github.io/calvey-commons/

---

## Where things are

This repository holds everything a reader sees, one folder per book. Nothing private is kept here.

```
calvey-commons/
  index.html                          the library's front page, a card for each book
  lessons-in-nature-and-architecture/ Lessons in Nature + Architecture, by CALVEY + CLAUDE
    index.html                          the contents: a card for each of the nine chapters
    01-sun/                             Chapter 1, Sun: the page, its narration (audio/) and photographs (img/)
    CREDITS.md                          every photograph in the lessons, with its licence and source
  nature-and-architecture/            The Calvey and Claude Nature and Architecture Book
    index.html                          the book: read it, or listen to it
    audio/                              the narration, one recording per part, each beside its transcript
    images/                             the diagrams (00 to 09), the photographs, their small copies (thumbs/),
                                        the cover mosaics, and CREDITS.md
  nature-and-architecture-chatgpt/    The Calvey and ChatGPT Nature and Architecture Book, as it was made
    index.html  assets/  audio/  downloads/   (downloads: PDF, Word, Markdown, image credits)
  library/
    chatgpt-card/                       small copies of the six photographs on the ChatGPT book's card,
                                        with CREDITS.md
  tools/
    pour_nature_book.mjs                builds the Claude book's page from its chapter sources
    make_cover_and_thumbnails.py        makes that book's cover mosaics and small image copies
  LICENSE  README.md
```

The chapter sources, research notes and working prompts are kept in a private workshop folder, not here.

---

## What is here

### Lessons in Nature + Architecture, by CALVEY + CLAUDE
`lessons-in-nature-and-architecture/` — the teaching edition, and the place to start. It teaches how to bring the sun, air, earth, water, light and living things into buildings, from the best examples across history and the globe, in nine chapters of about five lessons each. Each lesson is about ten minutes, read aloud, on a page that highlights each sentence as it is spoken, opens each lesson as the voice reaches it, and lets you tap any sentence to jump there. Every lesson ends with rules of thumb, the conditions under which the idea fails, and three questions to test yourself. Its drawings are computed from solar geometry and the other sources each lesson names, and each lesson is checked against its sources by a reviewer that did not write it. Chapters are published as they are finished; Chapter 1, Sun, is out.

### The Calvey and Claude Nature and Architecture Book
`nature-and-architecture/` — ten parts, about 510,000 words, from the first painted caves to materials now being grown in laboratories; 46 photographs and other reproduced images, each under its own licence, and 239 original diagrams.

It asks how nature has been brought into, around and to the threshold of buildings, on three axes — time, place with its climate, and position: outside, at the threshold, or inside. Underneath that it asks a second question, which turned out to be the harder one: for every celebrated building and tradition, did anyone ever put instruments on it, and can anyone read the result?

The answers sorted into sixteen kinds, with four more still to be numbered, and they are the book's spine. The measurement was never made. It was commissioned, came back unfavourable, and the building went up anyway. It was made and is enclosed behind a paywall. It was made, given away freely, and lost anyway when the web page that held it changed. It was made and is reachable and does not support the claim it is cited for. It was made once and nobody funded the second visit.

Two things cut across all of it. Measurement density collapses at the façade — the space between buildings is instrumented finely and the rooms people occupy are barely measured at all. And it collapses again at the person.

### The Calvey and ChatGPT Nature and Architecture Book
`nature-and-architecture-chatgpt/` — *Nature + Architecture: an illustrated global history and practical design atlas.* Twelve chapters and a chapter for listening in one session, about 19,400 words, 36 figures and 13 narrated recordings (2 hours 23 minutes), with an illustrated PDF, an editable Word file and a Markdown manuscript to download. It was made separately, with ChatGPT and to its own method, and is published here as it was made. Its image credits are in `downloads/image-credits.html`; its fonts carry their own licence files in `assets/fonts/`.

---

## How to read the Claude book

Open the link above on a phone or a laptop. There is nothing to install and nothing to sign into.

**The cover** is every photograph and scan in the book, tiled small. The contents list shows each part's first image.

**Each part opens on its images.** Under its title are a Listen button and a strip of all its photographs and diagrams; touch any image to see it full size, with its creator, its licence and its source, and step through the rest.

**Read the chapter** opens its story — the chapter told for a reader and a listener, with its photographs and diagrams set beside the paragraphs they belong to. The Listen button reads exactly this text aloud. Below the story, folded, is **the evidence** it is told from: a summary of findings, the graded body, case cards, every figure with its credits, the generative rulebook, and the bibliography.

**Listening.** Each part has a narration of about forty-five minutes, and a play-all runs the whole book straight through and remembers where you stopped.

**Reading the marks.** A claim tagged `verified` means the source was opened and the claim confirmed. `not opened` means it was cited from a bibliographic record and nothing rests on it. `unfilled` means the research could not reach a figure and did not guess one. The two-part grades say what kind of statement a claim is and where its number came from.

---

## How the Claude book was made

Forty-one parallel research lanes, each instructed to hunt the instrumented study behind every celebrated case and to report its absence as a finding. About 869,000 words of graded notes stand behind the book. The research ran without a general web search — on bibliographic APIs and direct retrieval — which is stated in each chapter, because it shaped what could be reached. No image was fetched before its licence had been read at its source page.

It is written with Claude, and every chapter says so.

`tools/pour_nature_book.mjs` builds the book from a manifest and the chapter sources. It has no dependencies; run it with `node`. `tools/make_cover_and_thumbnails.py` (Python with Pillow) makes the cover mosaics and the small copies of the images. The chapter sources are not in this repository: they carry a layer of notes specific to a private project, which is lifted out before publication. The book itself is published whole.

---

## Citing

> Calvey, M. (2026). *Lessons in Nature + Architecture*, by CALVEY + CLAUDE. CALVEY COMMONS. https://matthewcalvey.github.io/calvey-commons/lessons-in-nature-and-architecture/

> Calvey, M. (2026). *The Calvey and Claude Nature and Architecture Book.* CALVEY COMMONS. https://matthewcalvey.github.io/calvey-commons/nature-and-architecture/

> Calvey, M. (2026). *Nature + Architecture: An illustrated global history and practical design atlas* (The Calvey and ChatGPT Nature and Architecture Book). CALVEY COMMONS. https://matthewcalvey.github.io/calvey-commons/nature-and-architecture-chatgpt/

For a finding inside any of the books, cite the original study from that book's references rather than the book. The books compile other people's research; the investigators did the work.

---

## Licence

[CC BY 4.0](LICENSE) — share and adapt freely, including commercially, with attribution.

This covers the compilation, the writing, the grading and the original diagrams of each book. It does not cover the underlying studies, which remain the work of the investigators named in each bibliography, under whatever terms those works carry. Images and fonts that carry a licence of their own keep it, and each book lists them: `lessons-in-nature-and-architecture/CREDITS.md`, `nature-and-architecture/images/CREDITS.md` and `nature-and-architecture-chatgpt/downloads/image-credits.html`; the small copies on the ChatGPT book's card are credited in `library/chatgpt-card/CREDITS.md`. The cover mosaics of the Claude book, which tile its reproduced images, are shared under CC BY-SA 4.0.

---

## Corrections

If something here is wrong — a misattributed figure, a study read incorrectly, a gap that is not actually a gap — please open an issue. The Claude book's own argument is that this field does not check itself often enough, so a correction is the most useful thing anyone can send.
