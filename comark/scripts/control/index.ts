// CONTROL for the "no Node built-ins" claim: a Worker that does import one. Built with the
// no-compat config it must make the Cloudflare plugin warn, which proves the detector works.
import { basename } from 'node:path'

export default {
  fetch(request: Request): Response {
    return new Response(basename(new URL(request.url).pathname))
  },
}
