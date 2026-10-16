# ADR-034: Our deployments run from CI

Status: Accepted (2026-10-16)

## Context

Staging, the demo (its CMS, its blog and its agents) and hollware.com have been deployed by hand: a build per Worker with the right environment, `wrangler deploy`, `hollware migrate --remote`, and a check that the sites still answer. Every step is a chance to deploy the wrong environment, to forget the migration, or to leave a site broken. The maintainer asked (2026-10-16) that deploying run with no manual step.

## Decision

- **A workflow `deploy.yml`** builds and deploys each Worker of the repository with its environment, applies the migrations before the Worker that needs them, and checks the deployed sites with probes before it reports success.
- **Staging is deployed on every push to `main`**, which the hook pre-push checked as CI does; **production (the demo and hollware.com) on every push to `release`**, which its ruleset lets in only once the check of CI passed on that commit. The order and the probes are `scripts/deploy.ts`, which the maintainer may run by hand too, and whose plan a test holds: migrations before the Worker that needs them, the CMS before the sites that read it.
- **The job runs in the environment `deploy`,** turned on by the repository variable `DEPLOY_ENABLED` once the token is there, which holds a Cloudflare API token scoped to the maintainer's account (Workers scripts, D1, KV, Queues, Vectorize, custom domains) and its account id. Actions are pinned by SHA, `permissions` are empty by default, and no step runs code from a pull request.
- **A failed probe fails the run** and leaves the previous versions of the Workers to roll back to with `wrangler rollback`.

## Consequences

- Nobody runs a deploy of ours by hand; a release reaches the demo and hollware.com by itself.
- The Cloudflare token is the one secret of CI with write access outside GitHub; it lives in one environment.

## Alternatives considered

- Workers Builds (Cloudflare's own CI). Rejected for now: the monorepo builds several Workers in an order, with migrations between them, which one workflow states plainly.
- Deploying production on every push to `main`. Rejected: a release is the unit that reaches users.
