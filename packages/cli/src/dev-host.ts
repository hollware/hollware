export interface DevExit {
  readonly code: number | null
  readonly signal: string | null
}

export interface DevChild {
  readonly pid: number
  readonly exited: Promise<DevExit>
  readonly tail: () => string
}

export interface DevHost {
  spawn: (
    bin: string,
    args: readonly string[],
    cwd: string,
    options: { detached: boolean },
  ) => DevChild
  killGroup: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void
  isAlive: (pid: number) => boolean
  onSignal: (callback: () => void) => () => void
  healthy: (url: string) => Promise<boolean>
  sleep: (ms: number, cancel?: AbortSignal) => Promise<void>
}
