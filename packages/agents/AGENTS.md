# @hollware/agents

The agents of Hollware: a reviewer, a translator and a weekly auditor, run by the cron triggers of
a Worker of their own. Boundary rules for this package:

- The agents reach Hollware only over MCP, with a personal token, and only through `allowOnly`:
  no code path of theirs may call `publish`, `approve_review`, `request_changes` or `unpublish`.
  Their work reaches readers only through a person's approval (`request_review`).
- A role takes its ports (`Hollware`, `Model`, `Memory`) as arguments; the Worker builds them from
  its bindings. Never read `process.env`.
- No dependency beyond `@hollware/core`: the roles need a schedule, a little memory, MCP and a
  model, which a Worker has.
