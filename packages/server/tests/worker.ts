// The Worker of the test configuration (wrangler.jsonc). The tests reach the package's code
// directly; this entry only gives workerd a module to run.
export default {
  fetch() {
    return new Response('Not Found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
