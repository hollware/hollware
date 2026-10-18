# @hollware/admin

The admin of [Hollware](https://hollware.com), an open-source headless CMS for the agent era: entries
with their revisions and verdicts, the review queue, images, people and tokens, the structure of
each site and its activity log. People sign in with passkeys.

It ships prebuilt, as static files that the Worker serves at `/admin/`, and never becomes part of
the Worker's bundle. A project made with `npm create hollware` already has it: `adminAssets()` in
`vite.config.ts` points Vite at the built files.

## Links

- Docs: <https://hollware.com>
- Repository: <https://github.com/hollware/hollware>
- License: MIT
