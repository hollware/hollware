// What SMALL_POST (src/fixtures.ts) must come out as. Literals read once from the output and kept
// apart from the code under test, shared by the workerd test and the built-Worker test.

export const SMALL_POST_FRONTMATTER = {
  title: 'Mossgrid, a toy scheduler for greenhouse sensors',
  description: 'How a made-up scheduler staggers sensor reads so a coin cell lasts a season.',
  date: '2026-03-14',
  published: true,
  readingTime: 6,
  tags: ['scheduling', 'embedded'],
  author: { name: 'Ada Quill', links: ['https://example.com/ada'] },
}

export const SMALL_POST_HEADINGS = [
  { depth: 1, text: 'Mossgrid, a toy scheduler', id: 'mossgrid-a-toy-scheduler' },
  { depth: 2, text: 'Why stagger reads', id: 'why-stagger-reads' },
  { depth: 3, text: 'The scheduler loop', id: 'why-stagger-reads-the-scheduler-loop' },
  { depth: 2, text: 'Measured battery life', id: 'measured-battery-life' },
]

// Joined with "\n" so every space and newline of the renderer is visible.
export const SMALL_POST_HTML = [
  '<h1 id="mossgrid-a-toy-scheduler">Mossgrid, a toy scheduler</h1>',
  '<p>Mossgrid staggers sensor reads so a coin cell lasts a growing season. Read the <a href="/notes/design/">design notes</a> first, then the <a href="https://example.com/mossgrid">upstream repo</a>.</p>',
  '<h2 id="why-stagger-reads">Why stagger reads</h2>',
  '<p><img src="/img/seedlings.png" title="Seedlings under a lamp" alt="A tray of seedlings under a lamp"></p>',
  '<p>Reading every sensor at once drains the cell in a burst.</p>',
  '<callout type="tip" title="Rule of thumb">',
  '  Keep the <strong>duty cycle</strong> under 2%, and read the <badge tone="blue">',
  '    cold',
  '  </badge> sensors last.',
  '</callout>',
  '<h3 id="why-stagger-reads-the-scheduler-loop">The scheduler loop</h3>',
  '<pre language="ts"><code class="language-ts">export function nextSlot(now: number, period: number): number {',
  '  return now + (period - (now % period))',
  '}</code></pre>',
  '<h2 id="measured-battery-life">Measured battery life</h2>',
  '<table>',
  '  <thead>',
  '    <tr>',
  '      <th>Sensor</th>',
  '      <th style="text-align:right">Period (s)</th>',
  '      <th style="text-align:right">Battery (days)</th>',
  '    </tr>',
  '  </thead>',
  '  <tbody>',
  '    <tr>',
  '      <td>soil</td>',
  '      <td style="text-align:right">60</td>',
  '      <td style="text-align:right">210</td>',
  '    </tr>',
  '    <tr>',
  '      <td>air</td>',
  '      <td style="text-align:right">30</td>',
  '      <td style="text-align:right">140</td>',
  '    </tr>',
  '  </tbody>',
  '</table>',
  '<p>Back to the <a href="/notes/">notes index</a>.</p>',
].join('\n')

export const SMALL_POST_LINKS = [
  { href: '/notes/design/', text: 'design notes', kind: 'internal' },
  { href: 'https://example.com/mossgrid', text: 'upstream repo', kind: 'external' },
  { href: '/notes/', text: 'notes index', kind: 'internal' },
]

export const SMALL_POST_IMAGES = [
  {
    src: '/img/seedlings.png',
    alt: 'A tray of seedlings under a lamp',
    title: 'Seedlings under a lamp',
  },
]

export const SMALL_POST_COMPONENTS = [
  { name: 'callout', props: { type: 'tip', title: 'Rule of thumb' } },
  { name: 'badge', props: { tone: 'blue' } },
]
