# hollware (the CLI)

The `hollware` command. Boundary rules for this package:

- It never loads `hollware.config.ts`.
- It talks to the project through `wrangler` and to a running Hollware over MCP.
- `main(argv, io)` in `src/index.ts` only uses its arguments. The entry-point code below it
  is the only code that touches `process` (`argv`, the streams and the exit code).
- Never read `process.env`: configuration arrives as arguments.
