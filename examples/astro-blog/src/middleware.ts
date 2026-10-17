import { hollwarePreview } from '@hollware/astro'

// The link of the admin's "Preview on the site" is exchanged for a cookie on the first request,
// and every page after it finds the token in `Astro.locals.hollwarePreview`.
export const onRequest = hollwarePreview()
