export class CliError extends Error {
  override readonly name: string = 'CliError'
}

export class UsageError extends CliError {
  override readonly name: string = 'UsageError'
}
