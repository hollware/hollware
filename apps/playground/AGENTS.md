# apps/playground

The playground runs locally and in the tests; `env.demo` and `env.staging` of `wrangler.jsonc` are
the deployments `scripts/deploy.ts` builds with `CLOUDFLARE_ENV`.

- Bindings do not inherit into an environment: a binding added at the top is named again in
  `env.demo` and `env.staging`.
- A Vectorize index serves one embedding model: another `HOLLWARE_EMBEDDING_MODEL` is another index,
  named after the model.
- The agents of `examples/agents-worker` have no cron trigger: Hollware's own cron wakes them
  through the `AGENTS` binding (the free plan has five cron triggers for the account).
- The demo's blog is `examples/nuxt-blog` (`env.demo`), deployed under the Worker name of
  `examples/worker-site`, which holds demo.hollware.com: going back is a deploy of that example.
