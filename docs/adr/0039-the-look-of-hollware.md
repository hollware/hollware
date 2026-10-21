# ADR-039: The look of Hollware

Status: Accepted (2026-10-21)

## Context

Until 1.0 the look of hollware.com, the admin and the sign-in pages was a theme and nothing more:
Nuxt UI with white as the primary color, emerald as the secondary, neutral greys, Inter and
JetBrains Mono, and an "H" in a rounded square as the mark. It was consistent, and a guard kept it
so (`tests/conventions/brand.test.ts`), but it said nothing about Hollware: any product with an H
could have used it.

The name already carries an idea. _Hollow_ is a CMS with no head and no servers to run, and the
name nods to Hallow's End and its Headless Horseman, whose head is a carved pumpkin with a light
inside. A brand book was worked out on 2026-10-21, in rounds of questions and explorations, and
settled the identity: the brief (solid infrastructure, a product layer that stays sober and a
community layer with more voice, dark only, a warm accent that is not Cloudflare's orange), the
mark, the colors, the type and the voice.

## Decision

- **The mark is the flame pumpkin**: a flame whose lower half is a carved pumpkin with slanted eyes
  and a grin with two fangs, the mouth open through its base. It is one flat shape with no gradient
  or outline, its cut-outs transparent, drawn in a box of 204 × 243. The same path is the favicon,
  the logo of the site and of the admin, and the mark of the sign-in pages, at every size.
- **The wordmark** is `hollware` in lower case, Schibsted Grotesk 700, letter spacing −0.045 em.
  In running text the name is Hollware.
- **The colors are Carbón and flame.** Carbón is a scale of warm greys whose 950, `#0e0c0a`, is the
  ground of everything; flame is the brand's amber, `#f0a93b` at 400. In Nuxt UI, Carbón is the
  neutral and the primary, its warm white (100) the default of every button and link, as white was
  before; flame is the secondary, the role emerald had: the mark, the main action of a page (publish,
  read the docs) and the accents. Amber is scarce on purpose. Cloudflare's orange stays for naming
  Cloudflare's products only.
- **The type is Schibsted Grotesk and JetBrains Mono**, bundled with `@fontsource-variable`, so no
  page fetches a font from another origin. The sign-in pages keep the system's type: their policy
  loads no font.
- **Dark only**, as before.

`tests/conventions/brand.test.ts` holds it: one theme block in both stylesheets with these fonts
and scales, the same Nuxt UI colors in both configs, the ground and accent of the sign-in pages,
and one path for the mark everywhere it is drawn.

## Consequences

- Inter leaves the catalog and Schibsted Grotesk enters it; the size of the fonts the site and the
  admin ship stays about the same.
- Every place that used emerald as the secondary is amber now, with no change to the templates:
  publishing in the admin, the accents of the landing page. Its main call to action, Read the docs,
  turns amber too.
- The mark is a traced drawing: its curves are kept as they are, and a change to it is a change of
  the one path the test compares.
- The brand book, with the voice, the vocabulary and the applications, is a document outside the
  repository; this record and the guard are what the repository holds of it.

## Alternatives considered

- **Keep the theme and draw a new mark only.** Emerald on near-black is the look of many AI
  products, and the accent should come from the idea of the name, the light inside the pumpkin.
- **A geometric mark** (a headless bust, a hollow vessel, a lit "h"). Explored and set aside: they
  read as generic icons, and the flame pumpkin is more Hollware's own and easier to remember.
- **A closed base**, the mouth inside the silhouette, which reads better at 16 px. The open base
  was chosen for every size: it is the drawing as it was made, and the character is in that grin.
- **Amber as Nuxt UI's primary.** Tried first: every button with no color of its own turned amber,
  outlines and cancels included, and the main action stopped standing out.
- **Tailwind's own `amber`**. It is a different amber, and naming the brand's scale `flame` keeps
  Tailwind's palette as it is.
