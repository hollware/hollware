# ADR-008: Independent project, MIT, own GitHub organization

Status: Accepted (2026-10-11)

## Context

Hollware is an open source project with a thesis of its own. It has to be easy for anyone to read, use and contribute to, and for coding agents to work on. That depends on a few choices that are cheap to make before the first commit and expensive to change afterwards: who owns the repository, how it is licensed, which language it is written in, and where the instructions for agents live.

Claude Code 2.1.277 and later reads `AGENTS.md` when a repository has no `CLAUDE.md`. When both files exist, it reads only `CLAUDE.md`.

## Decision

- Hollware is an independent open source project, public from the first commit and licensed under MIT. The copyright line is "Copyright (c) 2026-present Sergio Azócar and Hollware contributors". There is no CLA.
- The repository lives in its own GitHub organization, `hollware`, as `hollware/hollware`, with a matching npm organization, `@hollware`.
- Everything in the repository is written in English: code, documentation, commit messages and instructions for agents.
- Instructions for agents live in `AGENTS.md`, at the root and in each package. There is no `CLAUDE.md`, and there must never be one.
- Governance exists from the first day: a README, `CONTRIBUTING`, a code of conduct (Contributor Covenant 2.1), a `SECURITY.md` that points to GitHub's private vulnerability reporting, issue forms and a pull request template. Commits follow Conventional Commits, and git hooks run through `vp staged`.

## Consequences

- Anyone can read the whole history, send a pull request or fork the project.
- There is nothing to sign before contributing, and the copyright line credits Hollware contributors next to the author.
- An organization allows controls that a personal account does not: required two-factor authentication, an `npm` environment that needs maintainer approval, and rulesets for tags and releases (see [ADR-014](0014-release-pipeline.md)).
- Agents get one source of instructions. `AGENTS.md` only orients: whatever a test, a lint rule or a type can enforce is enforced there, not written down as a request.
- A single language for the whole repository keeps it readable for contributors and agents from anywhere.

## Alternatives considered

- Hosting the repository under a personal GitHub account. Not chosen: an organization carries the controls a release pipeline needs and does not tie the project to one person's account.
- Asking contributors to sign a CLA. Not chosen: it adds friction for every contributor.
- Keeping a `CLAUDE.md` next to `AGENTS.md`. Rejected: when both exist, Claude Code reads only `CLAUDE.md`, so the two files would diverge.
