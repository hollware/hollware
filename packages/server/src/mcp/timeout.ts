/**
 * Runs `work` and gives up on it when it takes longer than `limitMs`: the answer is the error
 * that `onTimeout` makes. The work is not stopped, because a promise cannot be: an operation that
 * ran out of time may still finish, and the error says so. Whichever finishes first, the timer
 * is cleared, and a failure of the work after the timeout is already handled by the race.
 */
export async function within<T>(
  work: Promise<T>,
  limitMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(onTimeout()), limitMs)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
