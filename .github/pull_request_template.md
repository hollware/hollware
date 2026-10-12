## Summary

<!-- What does this change, and why? A few sentences are enough. -->

## Linked issue

<!-- Closes #123. A small fix does not need an issue; for anything larger, link the issue where the approach was agreed. -->

## Tests

<!-- For each new or changed test, the production line that must change for it to fail. If a test has no such line, it is tautological: strengthen it or delete it. Write "n/a" if the change has no code. -->

## Checklist

- [ ] A changeset is included if a published package changed (`pnpm exec changeset`).
- [ ] Tests are added or updated, and breaking the line named above with `scripts/break-line.ts` reports `CAUGHT`: the command passes as it is and fails with the line broken, in the test named above.
- [ ] `AGENTS.md` and the docs are updated if an invariant, a convention or a structural decision changed, and the invariant is bound to a test, a lint rule or a type.
- [ ] `pnpm exec vp run check:push` passes.
