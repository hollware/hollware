export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    // A probe for the tests: the Node.js globals of this Worker and of the playground behind
    // the service binding. Both opt out of Node.js compatibility, so both lists are empty.
    if (pathname === '/__node-globals') {
      return Response.json({
        site: ['process', 'Buffer', 'setImmediate'].filter((name) => name in globalThis),
        playground: await env.PLAYGROUND.nodeGlobals(),
      })
    }
    // The path is the message, so the answer follows the request instead of being fixed.
    return new Response(await env.PLAYGROUND.ping(pathname))
  },
} satisfies ExportedHandler<SiteEnv>
