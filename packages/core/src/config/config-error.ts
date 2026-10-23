/** One thing wrong with the config, found by `resolveConfig`. */
export interface ConfigProblem {
  /** Where it is, from the root of the config: `sites.playground.collections.blog.routes`. */
  readonly path: string
  /** What is wrong, as a sentence without its final period. */
  readonly message: string
  /** What to change, as a sentence with its final period. */
  readonly fix: string
}

/**
 * The error `resolveConfig` throws: every problem of the config at once, so that a broken
 * `hollware.config.ts` stops the Worker at startup with a message that says what to change. The
 * message has one line per problem, `<path>: <message>. <fix>`, and `problems` holds them as data.
 */
export class ConfigError extends Error {
  override readonly name = 'ConfigError'
  readonly problems: readonly ConfigProblem[]

  constructor(problems: readonly ConfigProblem[]) {
    super(
      problems.map((problem) => `${problem.path}: ${problem.message}. ${problem.fix}`).join('\n'),
    )
    this.problems = problems
  }
}

export class Problems {
  readonly list: ConfigProblem[] = []

  add(path: string, message: string, fix: string): void {
    this.list.push({ path, message, fix })
  }
}
