export const SITE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The longest a site key can be. */
export const SITE_KEY_MAX_LENGTH = 64

/** Whether a value is a site key: a string that fits `SITE_KEY_PATTERN` and is not too long. */
export function isSiteKey(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= SITE_KEY_MAX_LENGTH && SITE_KEY_PATTERN.test(value)
  )
}
