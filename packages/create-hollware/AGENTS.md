# create-hollware

`npm create hollware <dir>`. Boundary rules for this package:

- It copies `templates/starter`: the template is the single source of the starter project.
- It pins exact Hollware versions in the project it creates, never a range or `latest`.
- `main(argv, io)` in `src/index.ts` only uses its arguments. The entry-point code below it
  is the only code that touches `process` (`argv`, the streams and the exit code).
- Never read `process.env`: configuration arrives as arguments.
- The template holds `.gitignore` as `gitignore`, which `writeProject` renames: npm leaves a
  `.gitignore` out of a package.
- The queues get the project's name (`<name>-events`): queue names are unique in an account.
- With `--pm pnpm` it writes `allowBuilds` (`PNPM_WORKSPACE`): esbuild's script makes the binary
  wrangler runs; workerd's binary arrives through `optionalDependencies`, so its script stays off.
- It runs `vp fmt` after it writes the names: a longer one can push a line past the formatter's width.
