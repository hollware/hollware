// Synthetic fixtures: a made-up technical post about a made-up project. Nothing here comes from a
// real site. Used by the workerd tests (exact assertions), the Node tests and the CPU benchmark.

/**
 * The S3a document: YAML frontmatter, headings, links (internal and external), an image, a fenced
 * code block, a table, one block component with props and a default slot, and one inline component
 * (nested inside the block component's slot).
 */
export const SMALL_POST = `---
title: Mossgrid, a toy scheduler for greenhouse sensors
description: How a made-up scheduler staggers sensor reads so a coin cell lasts a season.
date: 2026-03-14
published: true
readingTime: 6
tags:
  - scheduling
  - embedded
author:
  name: Ada Quill
  links:
    - https://example.com/ada
---

# Mossgrid, a toy scheduler

Mossgrid staggers sensor reads so a coin cell lasts a growing season. Read the [design notes](/notes/design/) first, then the [upstream repo](https://example.com/mossgrid).

## Why stagger reads

![A tray of seedlings under a lamp](/img/seedlings.png "Seedlings under a lamp")

Reading every sensor at once drains the cell in a burst.

::callout{type="tip" title="Rule of thumb"}
Keep the **duty cycle** under 2%, and read the :badge[cold]{tone="blue"} sensors last.
::

### The scheduler loop

\`\`\`ts
export function nextSlot(now: number, period: number): number {
  return now + (period - (now % period))
}
\`\`\`

## Measured battery life

| Sensor | Period (s) | Battery (days) |
| ------ | ---------: | -------------: |
| soil   |         60 |            210 |
| air    |         30 |            140 |

Back to the [notes index](/notes/).
`

/** Words in a Markdown string, counted the way a reader would: whitespace-separated tokens. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

// A fixed word list so the generated posts are deterministic. Nothing here is real prose.
const WORDS = [
  'scheduler',
  'sensor',
  'battery',
  'greenhouse',
  'duty',
  'cycle',
  'moss',
  'grid',
  'window',
  'stagger',
  'burst',
  'cell',
  'season',
  'period',
  'slot',
  'tray',
  'lamp',
  'soil',
  'humidity',
  'probe',
  'latency',
  'jitter',
  'budget',
  'ledger',
  'drift',
  'clock',
  'sample',
  'reading',
  'threshold',
  'queue',
]

/** A deterministic sentence of `count` words, seeded so every call differs but is reproducible. */
function sentence(seed: number, count: number): string {
  const words: string[] = []
  for (let i = 0; i < count; i++) {
    words.push(WORDS[(seed * 7 + i * 13 + (i % 3) * seed) % WORDS.length] ?? 'moss')
  }
  const text = words.join(' ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

/**
 * One section of a generated post: a heading, two paragraphs (with inline formatting, a link and
 * inline code), a list, and a fenced code block. Roughly 100 words per section.
 */
function section(index: number): string {
  const n = index + 1
  return `## Section ${n}: stagger plan ${n}

${sentence(n, 14)} ${sentence(n + 1, 12)} Read the [design notes ${n}](/notes/design-${n}/) and the [upstream issue ${n}](https://example.com/mossgrid/issues/${n}). Use \`slot_${n}\` with **care** and _patience_.

${sentence(n + 2, 16)} ${sentence(n + 3, 13)}

- ${sentence(n + 4, 8)}
- ${sentence(n + 5, 7)}
- ${sentence(n + 6, 9)}

\`\`\`ts
export function slot${n}(now: number, period: number): number {
  return now + (period - (now % period)) + ${n}
}
\`\`\`
`
}

/**
 * A generated post with about `targetWords` words (counted with {@link countWords}), with
 * frontmatter, headings, lists, links, code blocks, two images, a table, and exactly two
 * components (one block component and one inline component), so extraction has a known answer.
 */
export function generatePost(targetWords: number): string {
  const header = `---
title: Staggering sensor reads, a long version
description: A generated post used to measure parse and render cost.
date: 2026-03-14
published: true
readingTime: ${Math.max(1, Math.round(targetWords / 200))}
tags:
  - scheduling
  - embedded
---

# Staggering sensor reads

${sentence(1, 20)} See the [overview](/notes/overview/).

![A tray of seedlings](/img/tray.png "Tray")

::callout{type="tip" title="Rule of thumb"}
Keep the **duty cycle** low, and read the :badge[cold]{tone="blue"} sensors last.
::

| Sensor | Period (s) | Battery (days) |
| ------ | ---------: | -------------: |
| soil   |         60 |            210 |
| air    |         30 |            140 |

![A lamp over a tray](/img/lamp.png "Lamp")

`
  let text = header
  let words = countWords(text)
  let index = 0
  // Whole sections while they fit, then one plain paragraph that lands exactly on the target.
  for (;;) {
    const next = `${section(index)}\n`
    const nextWords = countWords(next)
    if (words + nextWords > targetWords) break
    text += next
    words += nextWords
    index++
  }
  const remaining = targetWords - words
  if (remaining > 0) text += `${sentence(index + 50, remaining)}\n`
  return text
}
