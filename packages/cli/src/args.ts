import { parseArgs, type ParseArgsConfig } from 'node:util'
import { UsageError } from './errors.ts'

/**
 * `parseArgs` in strict mode: an unknown option, a missing value or a stray argument is a
 * `UsageError` with one short sentence, instead of Node's error with its advice about `--`.
 */
export function parseFlags<const Config extends ParseArgsConfig>(
  config: Config,
): ReturnType<typeof parseArgs<Config>> {
  try {
    return parseArgs(config)
  } catch (error) {
    if (
      error instanceof TypeError &&
      'code' in error &&
      String(error.code).startsWith('ERR_PARSE_ARGS_')
    ) {
      const [sentence = error.message] = error.message.split('. ')
      throw new UsageError(`${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}.`)
    }
    throw error
  }
}
