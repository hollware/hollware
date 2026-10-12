export default {
  async fetch(request, env) {
    // The path is the message, so the answer follows the request instead of being fixed.
    const { pathname } = new URL(request.url)
    return new Response(await env.PLAYGROUND.ping(pathname))
  },
} satisfies ExportedHandler<SiteEnv>
