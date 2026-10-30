# @hollware/agents

The agents of Hollware: a reviewer, a translator and a weekly auditor, run by the cron triggers of
a Worker of their own (`run`), and the reviewer again for each `review.requested` Hollware delivers
(`handle(event, grant, env)` in `src/worker.ts`, which `reviewById` of `src/reviewer.ts` does with
the event's grant through `grantHollware`). `examples/agents-worker` exposes both on its
`HollwareAgents` entrypoint. Boundary rules for this package:

- The agents reach Hollware only over MCP, with a personal token (the cron) or the grant of a
  delivery (`handle`), and only through `allowOnly`:
  no code path of theirs may call `publish`, `approve_review`, `request_changes` or `unpublish`.
  Their work reaches readers only through a person's approval (`request_review`).
- A role takes its ports (`Hollware`, `Model`, `Memory`) as arguments; the Worker builds them from
  its bindings. Never read `process.env`.
- No dependency beyond `@hollware/core`: the roles need a schedule, a little memory, MCP and a
  model, which a Worker has.
- A run of a free Worker has 50 subrequests: one role a run (`roleAt`), and `MAX_PAGES`,
  `MAX_REVIEWS`, `FIX_ROUNDS` and the translator's `limit` keep a role under them. `MAX_COMMENT`
  stays under the 4,000 characters of `comment_review` (`tests/reviewer.test.ts`).
- A request over a service binding carries no Host: `mcpHollware` sets the public URL's, which
  Hollware's guard compares.
