# Hollware brand book

How Hollware looks and speaks: hollware.com, the docs, the admin, the CLI, the READMEs and anything
made for the community. The decision and the alternatives are in
[ADR-039](adr/0039-the-look-of-hollware.md); the rules a test can hold are in
`tests/conventions/brand.test.ts`. This file is the reference for everything else: read it before
designing a page, writing copy for the product, or making an asset.

## Contents

- [The idea](#the-idea)
- [The mark](#the-mark)
- [Color](#color)
- [Type](#type)
- [Voice](#voice)
- [Imagery](#imagery)
- [Applications](#applications)
- [Where the brand lives in the code](#where-the-brand-lives-in-the-code)

## The idea

**No head. A fire inside.** Hollware is a headless CMS: no head, no servers to run. The brand takes
the name literally. It comes from Hallow's End and the Headless Horseman, and its symbol is the
pumpkin the Horseman carries for a head: hollow, carved, with a flame inside.

**Agents write. Contracts check. People decide what is published.**

| Piece      | What it says                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| Essence    | Hollow and lit: a CMS with no head that holds content and serves it.                                          |
| Promise    | Fast writing, safe publishing: Hollware finds an agent's mistakes, says how to fix them, keeps them off site. |
| For whom   | Teams that already have a frontend and want their agents to write the content, and the people who approve.    |
| Difference | Made for agents: MCP first, contracts at write time, Markdown as the source, all on your Cloudflare account.  |

**Two layers, one brand.** The product layer (site, docs, admin, CLI, GitHub, npm) is solid
infrastructure: the mark and the color carry the character, the interface and the copy stay sober.
The community layer (talks, social, merch) is the same brand with more voice: dry humor and nods to
Hallow's End are welcome there. There is no mascot or character beyond the mark.

**Three audiences.** The developer who integrates (reads the code before the landing page), the
person who approves (needs to trust nothing ships without them), and the agent that writes: it reads
the descriptions of the MCP tools and the error messages, and that text is the brand too.

| Personality   | Is                                             | Is not                                  |
| ------------- | ---------------------------------------------- | --------------------------------------- |
| Solid         | Infrastructure a CTO adopts without a doubt    | An experiment or a toy                  |
| Precise       | Says what happens, with real numbers and names | Vague, "AI-powered"                     |
| Has character | A mark with a face, that people remember       | Neutral to the point of interchangeable |
| Dry humor     | A timely wink, mostly in the community layer   | Jokes, memes or emoji in the product    |

## The mark

**The flame pumpkin**: a flame whose lower half is a carved pumpkin with slanted eyes and a grin
with two fangs. The mouth opens through the base: the pumpkin is hollow. It is one flat shape, with
no gradient and no outline, and its cut-outs are transparent.

- **Source**: `apps/web/public/favicon.svg`, one path in a box of 204 × 243. Every other copy of the
  mark (the site's logo, the admin's logo, the sign-in pages) uses that same path, and the brand
  test fails when one drifts. Scale it from the SVG, never from a bitmap.
- **One cut for every size**, the open base included, from 16 px up.
- **Wordmark**: `hollware` in lower case, Schibsted Grotesk 700, letter spacing −0.045 em. In
  running text the name is **Hollware**, never HollWare, Hollow Ware or HW. Where the wordmark is
  HTML, the text stays `Hollware` and CSS sets it in lower case, so a screen reader says the name.
- **Lockups**: horizontal (the mark at 1.18 times the type size, a gap of 0.32 times the type size)
  and vertical (the mark centred above the wordmark).
- **Clear space**: a quarter of the height of the mark on every side.
- **Minimum size**: the mark at 16 px high; the horizontal lockup at 96 px wide.

| Version           | Mark                 | Ground                           |
| ----------------- | -------------------- | -------------------------------- |
| Main              | flame 400 `#f0a93b`  | Carbón 950 `#0e0c0a`             |
| On amber          | Carbón 950 `#0e0c0a` | flame 400 `#f0a93b`              |
| On a light ground | flame 600 `#b87513`  | a light ground such as `#f4efe6` |
| One color         | Carbón 100 `#f2ede4` | any dark ground                  |

Never: rotate it, stretch it, give it a gradient, a glow or a shadow, draw it as an outline, change
its color outside the table above, or color it with Cloudflare's orange.

## Color

**Carbón and flame**: the night and the fire. The product is dark only; a light ground exists for
things outside it (a README in light mode, the press, print).

| Role                     | Token        | Value     | Use                                                      |
| ------------------------ | ------------ | --------- | -------------------------------------------------------- |
| Ground                   | `carbon-950` | `#0e0c0a` | The ground of every page                                 |
| Surface                  | `carbon-900` | `#17140f` | Cards, panels, code                                      |
| Line                     | `carbon-800` | `#2a251d` | Borders                                                  |
| Muted text               | `carbon-400` | `#9e968a` | Secondary text, captions                                 |
| Text                     | `carbon-200` | `#e6dfd3` | Body text                                                |
| Highlighted text         | `carbon-100` | `#f2ede4` | Headings, the default button and link                    |
| Amber                    | `flame-400`  | `#f0a93b` | The mark, the main action of a page, accents             |
| Amber on light, graphics | `flame-600`  | `#b87513` | The mark on a light ground (not text: it fails contrast) |
| Amber on light, text     | `flame-700`  | `#8a560c` | Amber text and links on a light ground                   |

The full scales, 50 to 950, are in the theme block of `apps/web/app/assets/css/main.css`.

**Amber is scarce on purpose.** A typical screen is about 82 % Carbón, 12 % text and 5 % amber. In
Nuxt UI, Carbón's warm white is the `primary` (the default of every button and link) and flame is
the `secondary`: a page has one amber action (Publish in the editor, Read the docs on the landing
page) and a few amber accents. Never make amber the default color of a component.

**Status colors stay apart from amber**, so an accent never reads as a warning: success `#6fbf8e`,
warning `#e5c14b`, error `#e5675c` (Nuxt UI's `success`, `warning` and `error` in the product).
Cloudflare's orange, `#f6821f`, names Cloudflare's products and nothing else.

## Type

| Face              | Role                                        | Weights                                       |
| ----------------- | ------------------------------------------- | --------------------------------------------- |
| Schibsted Grotesk | Headings, body, interface, the wordmark     | 400 body, 500–600 interface, 650–700 headings |
| JetBrains Mono    | Code, commands, MCP tools, uppercase labels | 400–500                                       |

Both are OFL and travel with the site and the admin through `@fontsource-variable`: no page fetches
a font from another origin. The sign-in pages of the Worker load no font and use the system's.

| Level      | Size / line height | Weight | Tracking |
| ---------- | ------------------ | ------ | -------- |
| Display    | 64 / 1.0           | 700    | −3.5 %   |
| H1         | 44 / 1.06          | 700    | −3.5 %   |
| H2         | 30 / 1.15          | 650    | −2.5 %   |
| H3         | 20 / 1.3           | 650    | −1.5 %   |
| Body       | 16 / 1.65          | 400    | 0        |
| Mono label | 11.5, uppercase    | 400    | +8 %     |

## Voice

Hollware speaks like a good error message: it says what happened, where, and how to fix it. In the
community layer it adds dry humor and a little night, never at the cost of clarity. It is written in
English first; Spanish is a careful translation, not a new text.

1. **Say what happens.** Describe the mechanism, not the feeling.
2. **Use numbers.** $0 to $5 a month, milliseconds, the exact number of tools.
3. **The agent writes, the person decides.** Agents write, read and ask for review; they do not
   "think" or do magic.
4. **Short sentences, active voice.** One verb per idea.
5. **Every error carries its fix**, on the site, in the CLI, over MCP and in the admin.

The model of the whole voice is a contract's verdict:

```text
✗ frontmatter.date   missing
  fix  Add `date` as YYYY-MM-DD, the day the post goes live.
✓ slug               unique in posts
```

| Not this                                                      | This                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| The revolutionary AI-powered CMS that unleashes your content. | The CMS your agents write to.                                                   |
| Blazing-fast, seamless publishing ⚡                          | Live in seconds, with no rebuild.                                               |
| Let AI write your content on autopilot.                       | Your agents write. Hollware checks every change. People approve what goes live. |
| Oops! Something went wrong 😅                                 | The field `date` is missing. Add it as YYYY-MM-DD.                              |
| Spooky fast! 🎃👻                                             | No head. No servers.                                                            |

| Line                                           | Spanish                                                               | Where             |
| ---------------------------------------------- | --------------------------------------------------------------------- | ----------------- |
| The CMS your agents write to.                  | El CMS en el que escriben tus agentes.                                | Headline, product |
| Made for agents, kept by people.               | Hecho para agentes, cuidado por personas.                             | Sign-off, product |
| Agents write. Contracts check. People publish. | Los agentes escriben. Los contratos verifican. Las personas publican. | How it works      |
| No head. No servers.                           | Sin cabeza. Sin servidores.                                           | Community         |

**In one line**: Hollware is an open-source headless CMS on Cloudflare where AI agents write the
content and people approve what is published.

**In one paragraph**: Hollware is a headless CMS for teams that already have a frontend and want
their agents to write the content. Agents write Markdown over MCP, contracts check every write and
explain how to fix what fails, and people approve what goes live. It runs as one Worker on your own
Cloudflare account, from $0 a month, under the MIT license.

**Vocabulary.** The same words everywhere: entry, draft, contract, verdict, review, publish,
collection, site (entrada, borrador, contrato, veredicto, revisión, publicar, colección, sitio).
Never: AI-powered, magic, autopilot, seamless, unleash, next-gen, blazing fast, spooky.

## Imagery

- **Real artifacts**: the terminal, Markdown, the admin's diffs, MCP answers, with synthetic but
  believable data. No stock photos, no AI illustrations.
- **Flat color**: no gradients, shadows or glows on the mark or on illustrations; the light is said
  with amber, not with effects. A soft amber wash behind a hero (`backdrop-glow`) is the one
  exception, and it never touches the mark.
- **Icons**: Lucide, as Nuxt UI ships them, 1.5 px stroke, in the color of the text. Never sparkles
  ✨ to mean "AI".
- **The grid**: a thin line grid that fades towards the edges is the backdrop of heroes and social
  images (`backdrop-grid`).
- **Halloween, with measure**: the mark is already the pumpkin. No bats, cobwebs or ghosts, and the
  product does not dress up in October.
- **Motion**: if the mark moves, the flame flickers slightly, in under a second, and
  `prefers-reduced-motion` turns it off.

## Applications

- **Social image (1200 × 630)**: Carbón ground with the grid, the horizontal lockup at the top left,
  the headline in Schibsted 700, a mono line `OPEN SOURCE · MIT · CLOUDFLARE WORKERS`, and the mark
  large on the right.
- **CLI**: the name in amber, success marks in the success green, the rest in the terminal's text
  and dim colors.
- **Admin and sign-in**: Carbón, the mark in the bar, one amber button per page.
- **README**: `<picture>` with `prefers-color-scheme` serves the lockup in flame 400 on dark and
  flame 600 on light.
- **Merch**: a die-cut sticker of the mark on Carbón with a light edge; an amber sticker with the
  mark in Carbón and "No head. No servers."; a black T-shirt with the mark and "Made for agents,
  kept by people."

## Where the brand lives in the code

| File                                                                | What it holds                                                         |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/web/app/assets/css/main.css`, `packages/admin/app/app.css`    | The theme block, identical in both: fonts, the two scales, the ground |
| `apps/web/app/app.config.ts`, `packages/admin/vite.app.config.ts`   | Nuxt UI's colors: primary carbon, secondary flame, neutral carbon     |
| `apps/web/public/favicon.svg`                                       | The mark: the one path every copy uses                                |
| `apps/web/app/components/AppLogo.vue`, `packages/admin/app/App.vue` | The logos of the site and the admin                                   |
| `packages/server/src/identity/pages.ts`                             | The sign-in pages: the ground, the accent and the mark                |
| `packages/admin/app/lib/preview.ts`                                 | The look of a draft's preview                                         |
| `tests/conventions/brand.test.ts`                                   | The guard of all of the above                                         |

A change to the look changes this file, the guard and, if it is structural, ADR-039 or a new ADR,
in the same commit.
