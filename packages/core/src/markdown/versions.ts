/**
 * The version of Comark that parses the Markdown, which every revision stores as `comark_version`.
 * Comark exports no version at runtime, so this constant is the one place that names it, and
 * `tests/markdown/versions.test.ts` binds it to the package that is installed.
 */
export const COMARK_VERSION = '0.7.0'

/**
 * The version of Hollware's own pipeline settings: the plugins, the allowlists, the heading ids,
 * the markers and the line numbers. Bump it whenever the same Markdown would give another
 * document or other extracted data, so that the reparse of the cron knows which revisions to rebuild.
 * `tests/markdown/versions.test.ts` pins the output for the shared fixtures, so a change that
 * forgets the bump fails there.
 */
export const PIPELINE_VERSION = '3'
