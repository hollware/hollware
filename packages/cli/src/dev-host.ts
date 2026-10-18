/** How a child process ended. */
export interface DevExit {
  readonly code: number | null
  readonly signal: string | null
}

/** A process the local server runs in, started as the leader of a group of its own. */
export interface DevChild {
  readonly pid: number
  /** Settles when the process ends. */
  readonly exited: Promise<DevExit>
  /** The last lines it printed (stdout and stderr), for the message of a failure. Empty when detached. */
  readonly tail: () => string
}

/**
 * What `hollware dev` takes from the machine, so that a test hands in a fake: processes (each the
 * leader of its own group, so that the server and what it started stop together), the signals
 * that stop it, the health check, and time. The entry point of `index.ts` builds the real one.
 */
export interface DevHost {
  /** Starts `bin` with `args` in `cwd`. Detached: the process outlives this one, in a group of its own. */
  spawn: (
    bin: string,
    args: readonly string[],
    cwd: string,
    options: { detached: boolean },
  ) => DevChild
  /** Sends the signal to the whole group of the process. Never throws when the group is gone. */
  killGroup: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void
  /** Whether a process with this id exists. */
  isAlive: (pid: number) => boolean
  /** Calls `callback` on SIGINT or SIGTERM, once. Returns a function that stops listening. */
  onSignal: (callback: () => void) => () => void
  /** True when `GET <url>/health` answers 200. Never throws. */
  healthy: (url: string) => Promise<boolean>
  /** Resolves after `ms` milliseconds, or at once when `cancel` aborts (and the timer is cleared). */
  sleep: (ms: number, cancel?: AbortSignal) => Promise<void>
}
