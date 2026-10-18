# ADR-038: Images in R2, converted once when they arrive

Status: Accepted (2026-10-18)

## Context

Hollware keeps Markdown and the structure of sites, and nothing else: an image is a path that the
site resolves on its own (`img: /images/talks/continuum.webp` in sergioazocar.com), so an agent
cannot publish a talk with its picture without a commit to the site's repository. Media was planned
for v0.2 (H4) and moved out of the path of v0.3; setting a site up end to end with an agent, the
goal of 1.0, needs it back.

Cloudflare has what it takes: R2 to keep the files, and the Images binding (`env.IMAGES`) to read
and convert them inside the Worker. A spike on 2026-10-18 ran the binding remotely (`remote: true`
under `wrangler dev`, the local simulation only implements width, height, rotation and format)
against a PNG with alpha, a two-frame GIF, a JPEG of 1200×1200 and an SVG with a script:

| Input             | Output asked            | Result                                                     |
| ----------------- | ----------------------- | ---------------------------------------------------------- |
| JPEG, 227 KB      | WebP, no `quality`      | 579 KB, **lossless** (VP8L): the default is not 85         |
| JPEG, 227 KB      | WebP, `quality: 85`     | 59 KB, lossy (VP8); a JPEG at 85 of it is 118 KB           |
| JPEG, 227 KB      | AVIF, `quality: 85`     | 46 KB                                                      |
| PNG icon, 66 KB   | WebP, `quality: 100`    | 44 KB, lossless, the same pixels                           |
| PNG with alpha    | WebP lossless and lossy | alpha kept in both (VP8L; VP8X + `ALPH`)                   |
| GIF of two frames | WebP, no `anim`         | **one frame**: the binding does not keep frames by default |
| GIF of two frames | WebP, `anim: true`      | animated (`ANIM`, two `ANMF`)                              |
| SVG               | `info()`                | `{ format: 'image/svg+xml' }`, no size                     |
| SVG               | WebP, or SVG out        | error 9412 (not an image), 9432 (no SVG output)            |

So `quality` and `anim` are always passed, never left to defaults that differ from the docs, and
an SVG never reaches the binding: Hollware has to judge it itself.

Pricing (developers.cloudflare.com/images/pricing, 2026-10-18): images stored outside Cloudflare
Images, as in R2, are "Images Transformed"; the Free plan includes 5,000 unique transformations a
month and refuses new ones past that with error 9422, never a charge; `.info()` is not billed.
Input is up to 20 MB. R2 keeps 10 GB free.

## Decision

**An asset is a file of a site, kept in R2 and described in D1, converted once when it arrives.**

- **Arrival.** `upload_asset` (MCP and `/v1/ops`, scope `content:write`) takes the bytes in
  base64 with a file name and an `alt`; the admin sends a file the same way. At most 10 MB of
  input. The type comes from the bytes (`info()`, and a check of the magic numbers before it),
  never from the name or a header: JPEG, PNG, WebP, AVIF, GIF and SVG, anything else refused with
  its fix. The same bytes in the same site are one asset (sha256), so an upload is idempotent.
- **Conversion, by the site's `media` setting** (in its definition, ADR-033, changed in the admin
  with no deploy): `{ format: 'webp' | 'avif' | 'original', quality: 85, maxWidth: 2400 }` by
  default `webp`, 85, 2400.
  - JPEG → the format at `quality` (lossy).
  - PNG → the format at `quality: 100` (lossless): screenshots, diagrams and logos keep their
    edges; alpha is kept either way.
  - GIF → the format with `anim: true`, frames kept.
  - WebP and AVIF → kept as they came, only scaled down past `maxWidth`.
  - `original` keeps every file as it came.
  - Wider than `maxWidth` → scaled down (`fit: 'scale-down'`), never up.
- **SVG is never converted, and never rewritten.** A vector picture stays a vector. Hollware
  accepts an SVG only when nothing in it can run or reach out: no `<script>`, `<foreignObject>`,
  `<iframe>`, `<embed>`, `<object>`, `on*` attribute, `javascript:` or `data:` URL, `<!DOCTYPE>`
  or `<!ENTITY>`, and no `href` outside the file (`#…`). Anything else is refused with a fix that
  names it: refusing is safer than a sanitizer that rewrites markup it half understands.
- **Keeping.** R2 holds the converted file at `sites/<site>/<asset id>.<ext>` and the original at
  `originals/…`, never served, so a site can convert again later (to AVIF, say) without asking for
  its images. D1 holds `assets(id, site_id, sha256, format, width, height, bytes, alt, created_by,
  created_at)`, with `site_id` and the guards of every table (ADR-031). An asset is never deleted
  while a revision names it: revisions are append-only, and a restore must find its pictures.
- **Reference.** Content names an asset as `asset:ast_<id>`: in a frontmatter field (`img:
  asset:ast_…`) and in Markdown (`![alt](asset:ast_…)`). The contract `images-have-alt` reads the
  asset's `alt` when the Markdown has none. Rendering and the read API resolve it to the asset's
  URL; MCP keeps it as written, so what an agent reads is what it wrote.
- **Delivery.** The Worker serves `GET /assets/<id>.<ext>` from R2, to anyone, with
  `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, and for
  an SVG `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`.
- **Sites own their pictures.** `hollware export --assets <dir> --assets-url <path>` writes each
  published asset to `<dir>` and rewrites `asset:` to `<path><id>.<ext>`; without the flags the
  export keeps `asset:` and writes `_assets/`, so `import` takes it back unchanged. A static site
  (sergioazocar.com) serves its images from its own domain, which is where search engines index
  them; the CMS's domain stays `noindex`.
- **Without the binding.** `IMAGES` is optional: a deployment without it keeps every file as it
  came (as `original`), and `hollware doctor` says so. Past the free 5,000 a month, an upload
  answers `media_unavailable` with its fix and keeps nothing.
- **Tests.** The Images binding is Cloudflare's, so tests replace it with a fake that records what
  it was asked; R2 and D1 stay real in Miniflare. The conversion matrix above is checked against
  the real service in a manual job, as the search evaluation is (`vp run eval:images`).

## Consequences

- An agent publishes a post or a talk with its pictures through MCP alone, and the admin gets a
  library of the site's images.
- Each new image costs one transformation (two when it is wider than `maxWidth`), so a site on the
  Free plan uploads up to about 5,000 images a month.
- The starter gains an R2 bucket and the Images binding; `hollware deploy` creates the bucket as it
  creates the database. Both enter the semver promise of ADR-036 (operations, the `asset:` scheme,
  `/assets/`, `export --assets`).
- SVGs with scripts, external references or entities are refused rather than cleaned; an author
  cleans them with any SVG optimizer first.
- The threat model gains the asset route, SVG and the upload size (T-104 onward).

## Alternatives considered

- **Convert on delivery** (`/cdn-cgi/image/` or the binding per request): a transformation per
  size and format asked, cached, but billed per variant and needing a zone; converting once is
  cheaper and keeps the file a site exports identical to the one Hollware serves.
- **Cloudflare Images storage** (`env.IMAGES.hosted`): variants for free, but a paid plan, and
  another store besides D1 and R2 to export and back up.
- **Sanitize SVG with a rewriter**: svg-hush is Rust, not in the binding; a Worker-side rewriter
  with HTMLRewriter does not parse XML. Refusing what is not plainly safe is smaller and provable.
- **Always WebP, no setting**: AVIF is 20 % smaller still in the spike, and some owners want their
  files as they are; one setting per site covers both at no cost.
