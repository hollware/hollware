# @hollware/agents

## 0.9.0

### Patch Changes

- Updated dependencies []:
  - @hollware/core@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [[`501174a`](https://github.com/hollware/hollware/commit/501174a4b9cd7e0a5191fa587c09e39f71ff3bd7), [`eaa743d`](https://github.com/hollware/hollware/commit/eaa743d4f6a6cb7ec5977f73379e6f414f43403f), [`f2f2c3d`](https://github.com/hollware/hollware/commit/f2f2c3d6ac6123d26bc1bc0d2b668b61d42afd9d), [`d1ea96e`](https://github.com/hollware/hollware/commit/d1ea96e61df8a7b58e0a9b5e76b85abdddc78a7a), [`3f3cb16`](https://github.com/hollware/hollware/commit/3f3cb16b9779defecc14c95b6607989a3dd22367), [`286149b`](https://github.com/hollware/hollware/commit/286149b7106adb84b5ee02b0433dc780b50be6e3)]:
  - @hollware/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`e43c814`](https://github.com/hollware/hollware/commit/e43c81420272ed1a0835ec681df11ac4cc259539)]:
  - @hollware/core@0.7.0

## 0.6.0

### Minor Changes

- [`03df44d`](https://github.com/hollware/hollware/commit/03df44d3ff8a24a3b285645f137cd973ff9e1b9c) Thanks [@sergioazoc](https://github.com/sergioazoc)! - The agents fit the Workers free plan: Hollware's cron wakes them every ten minutes over an `AGENTS` service binding to their `run` entrypoint, so they need no cron trigger of their own (five per account), and each run is one agent in turn, within the fifty calls a free run may make (the translator reads each locale in one listing, the reviewer takes eight reviews a run, the auditor checks a dozen entries a run and writes its report from them once a week). Their requests carry the Host of Hollware's public URL, which a service binding does not set. `hollware migrate --remote` takes a Time Travel bookmark of a database D1 cannot export, as any database with the full-text index of 0.5 is, instead of stopping.

- [`30339e0`](https://github.com/hollware/hollware/commit/30339e000c290ddbceab88161be35ef071ccbe0e) Thanks [@sergioazoc](https://github.com/sergioazoc)! - `@hollware/agents` (ADR-032): a reviewer that comments once on each pending review, a translator that drafts the missing translation of a published entry, fixes what the contracts refuse and asks for its review, and a weekly auditor that reports old but much-read entries and published entries the contracts refuse now, as a draft and optionally to a webhook such as Slack's. They run on a Worker of their own made by `createHollwareAgents`, reach Hollware over MCP with a personal token, and never publish: their client refuses every tool that publishes or decides. The new tool `request_review` asks for a review after the same checks as `publish` and never publishes, whatever the caller's scopes.

### Patch Changes

- Updated dependencies [[`30339e0`](https://github.com/hollware/hollware/commit/30339e000c290ddbceab88161be35ef071ccbe0e), [`059ecdf`](https://github.com/hollware/hollware/commit/059ecdffdd9d4394918dd594cf855898bf34b6d1)]:
  - @hollware/core@0.6.0
