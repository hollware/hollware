export interface Release {
  readonly installed: string
  readonly latest: string | null
  readonly newer: boolean
}

export function releaseNotesUrl(version: string): string {
  return `https://github.com/hollware/hollware/releases/tag/hollware%40${encodeURIComponent(version)}`
}
