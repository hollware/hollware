export default {
  fetch() {
    return new Response('Hollware is not implemented yet.', { status: 501 })
  },
} satisfies ExportedHandler<Env>
