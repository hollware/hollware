# Test fixtures

Synthetic content the tests of every package share. None of it comes from a real site. Load it with `tests/fixtures/content.ts`, which works in Node and inside workerd; never read these files with `node:fs`, which workerd lacks.

The Markdown files are kept byte for byte: `vite.config.ts` keeps the formatter away from `tests/fixtures/content`, and `content/hostile/bom.md` starts with a byte order mark on purpose.

- `content/blog/{en,es}/`: the corpus of the playground's blog (`apps/playground/hollware.config.ts`). Ten entries in five translation groups (`translationGroup`), with tags, internal links between them, a `callout` component, a code block and an image each.
- `content/bench/long-post.md`: the post the Markdown benchmark parses. Its body has 2,027 words: the whitespace-separated words of its text, outside code blocks; headings, list items, link text and the text inside components count, while URLs, the lines that open and close a component, and the marks of headings, lists, quotes, bold and emphasis do not.
- `content/hostile/`: one post per thing content safety stops (ADR-020): raw HTML inline and in blocks, an unknown component, disallowed attributes, unsafe URLs, 5,000 nested emphasis marks, frontmatter that does not parse, and a byte order mark.
- `content/invalid/`: posts that break one rule of the playground's blog each. Two are errors, a description over 160 characters and an image without alt text; three are warnings, a link to an entry that does not exist, a translation group with one locale and a title over 60 characters.

A file over a collection's `maxMarkdownBytes` is built in the test that needs it, not stored here.
