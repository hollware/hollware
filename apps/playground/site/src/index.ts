export default {
  async fetch(_request, env) {
    return new Response(await env.PLAYGROUND.ping())
  },
} satisfies ExportedHandler<SiteEnv>
