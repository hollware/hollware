# agents-worker

The Worker of `@hollware/agents` for the playground's blog: a reviewer, a translator and a weekly
auditor, none of which publishes. `src/index.ts` exports the `HollwareAgents` entrypoint, which
Hollware reaches over its service binding `AGENTS`:

- `handle(event, grant)`: Hollware delivers an event to the agent with a grant that acts as the
  agent's member for an hour. On `review.requested` the reviewer reads that review (`get_review`)
  and comments on it: one comment on the whole review when it changes one entry, one on each
  entry otherwise. A failure is thrown, so Hollware delivers the event again.
- `run()`: Hollware's cron wakes the agents every ten minutes; each run is one role, in turn.

## Deliver review requests to the reviewer

1. Make the agent member: in the admin under Agents, or with `hollware agent add reviewer`. Note its
   id (`usr_…`).
2. Declare the agent on the site in `hollware.config.ts`, and make approvals wait for it if you
   want:

   ```ts
   agents: [
     {
       name: 'reviewer',
       member: 'usr_…',
       events: ['review.requested'],
       delivery: { kind: 'binding', binding: 'AGENTS' },
       required: true,
     },
   ],
   review: { requireAgents: true },
   ```

3. Bind `AGENTS` in Hollware's `wrangler.jsonc` to this Worker's entrypoint:
   `{ "binding": "AGENTS", "service": "hollware-agents", "entrypoint": "HollwareAgents" }`.

The grant reads the site, reads that review and comments on it, and stops working once the review
is decided. No token is stored for this path.

## The cron roles

The translator, the auditor and the reviewer of every pending review still run from `run()` (or
the Worker's own cron trigger, `scheduled`) with a personal token of the site:

```sh
wrangler secret put HOLLWARE_AGENT_TOKEN
```

Without `HOLLWARE_AGENT_TOKEN` those roles log that they skip, and only `handle` works.

## Bindings

| Binding               | What it is                                                       |
| --------------------- | ---------------------------------------------------------------- |
| `HOLLWARE`            | The Hollware Worker, which the agents reach over MCP             |
| `HOLLWARE_PUBLIC_URL` | Its public URL, whose Host Hollware's guard compares             |
| `AI`                  | Workers AI, for the default model                                |
| `AGENTS_KV`           | What the agents remember: the reviews they read, the day's calls |
| `AGENTS_WEBHOOK_URL`  | Optional: where the weekly report is posted as well (a secret)   |
