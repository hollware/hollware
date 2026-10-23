import { parseArgs, type ParseArgsConfig } from 'node:util'
import { UsageError } from './errors.ts'

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
