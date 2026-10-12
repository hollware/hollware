// BASELINE for `wrangler check startup`: a Worker with no libraries, to tell the fixed cost of a Worker
// from what the Markdown pipeline adds.
export default {
  fetch(): Response {
    return new Response('ok')
  },
}
