/**
 * An error the person at the keyboard can act on. `main` prints its message on stderr, behind
 * the name of the command, and exits with code 1. Anything that is not a `CliError` is a bug or
 * a broken install, and escapes with its stack trace.
 */
export class CliError extends Error {
  override readonly name: string = 'CliError'
}

/**
 * A mistake in the arguments: an unknown option, a missing or a malformed value. `main` adds a
 * pointer to the help of the command after the message.
 */
export class UsageError extends CliError {
  override readonly name: string = 'UsageError'
}
