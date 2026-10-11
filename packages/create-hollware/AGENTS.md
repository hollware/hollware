# create-hollware

`npm create hollware <dir>`. Boundary rules for this package:

- It copies `templates/starter`: the template is the single source of the starter project.
- It pins exact Hollware versions in the project it creates, never a range or `latest`.
- `main(argv, io)` in `src/index.ts` only uses its arguments. The entry-point code below it
  is the only code that touches `process` (`argv`, the streams and the exit code).
- Never read `process.env`: configuration arrives as arguments.
