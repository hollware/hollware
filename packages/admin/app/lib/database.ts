export const FREE_PLAN_BYTES = 500_000_000
export const NEAR_SHARE = 0.8

export function databaseSize(bytes: number): {
  readonly megabytes: number
  readonly near: boolean
} {
  return {
    megabytes: Math.round(bytes / 100_000) / 10,
    near: bytes >= FREE_PLAN_BYTES * NEAR_SHARE,
  }
}
