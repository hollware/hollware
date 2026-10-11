# @hollware/admin

The review and approval UI. Boundary rules for this package:

- It is a prebuilt single-page app: the package ships built assets and nobody compiles it
  in their own project.
- It never enters the Worker bundle: Worker code never imports it.
- Never read `process.env`: configuration arrives as arguments.
