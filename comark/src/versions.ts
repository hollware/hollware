// Comark does not expose its version at runtime (no export, and `comark/package.json` is not in
// its `exports` map), so the pipeline pins it here and `test/node/versions.test.ts` compares these
// constants with the installed packages. Raising a dependency without raising these fails that test.
export const COMARK_VERSION = '0.7.0'
export const COMARK_HTML_VERSION = '0.7.0'
export const MARKDOWN_EXIT_VERSION = '1.1.0-beta.2'
