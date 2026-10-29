# hollware.com

The landing page and the docs. The pages read the `docs` site of Hollware over the `HOLLWARE`
service binding; no page text lives in this repository.

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
- The headline is "The CMS your agents write to." and the sign-off "Made for agents, kept by
  people."

## Build

- `buildDir: '.nuxt'` in `nuxt.config.ts` stays: a build elsewhere rewrites the types of the server
  routes to point there, and the type-check of the repository loses them.
