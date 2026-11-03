# hollware.com

The landing page and the docs. The pages read the `docs` site of Hollware over the `HOLLWARE`
service binding: the docs, and the collections `pages` (home, install, media kit), `features`,
`compare` and `glossary`, defined in `apps/playground/hollware.config.ts` and applied to the demo
with `set_collection` from `node scripts/web-structure.ts`. Only the words of the interface live in
`app/i18n`.

- Copy goes in the body and the slots of a component, never in its props: the contracts, search,
  the Markdown of a page and llms.txt read the body. A prop is an enum, a pattern or an id.
- A comparison cites a public source for every claim about another product, with the day it was
  read, and names no price.
- The shaders of `shaders` load only in `app/components/shader/ShaderScene.client.vue`, lazily, with
  telemetry off; a CSS ground is the design without WebGPU or with reduced motion.

## How Hollware speaks

The site, the docs, the admin, the CLI and every error speak alike:

- Say what happens: the mechanism, not the feeling. Use numbers (milliseconds, the number of
  tools, the bytes of a write).
- Promise no price: what Hollware costs depends on what each site uses, at Cloudflare's prices.
- The agent writes, the person decides: agents write, read and ask for review; they never "think".
- Short sentences, active voice. Every error carries its fix.
- English first; Spanish is a careful translation, not a new text.
- The same words everywhere: entry, draft, contract, verdict, review, publish, collection, site
  (entrada, borrador, contrato, veredicto, revisión, publicar, colección, sitio).
- The headline is "Let your agents publish. Nothing ships broken.", under the category "The CMS
  your agents write to", and the sign-off "Made for agents, kept by people."

## Build

- `buildDir: '.nuxt'` in `nuxt.config.ts` stays: a build elsewhere rewrites the types of the server
  routes to point there, and the type-check of the repository loses them.
