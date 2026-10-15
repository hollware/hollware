---
'create-hollware': patch
---

A project installs with npm, whose peer check refused Vite+'s core in place of `vite` (the starter now overrides every `vite` with its own), and with pnpm, which refused the build scripts of esbuild and workerd (a pnpm project gets a `pnpm-workspace.yaml` that allows them). A step that fails shows the last 30 lines of what it printed.
