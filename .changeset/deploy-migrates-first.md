---
'hollware': patch
'create-hollware': patch
---

`hollware deploy` of a project deployed before applies the new migrations to the remote database first, while its Worker still serves, and then deploys the new Worker, which so never serves a database without its tables. The starter's README and AGENTS.md say how to upgrade: one version for every package, a project of the new release to compare with, then deploy.
