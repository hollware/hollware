import type { OperationHandler } from './types.ts'

export const listBackups: OperationHandler<'list_backups'> = async (_input, context) => {
  const backups = context.backups ?? null
  if (backups === null) return { outcome: 'unavailable' }
  return { outcome: 'ok', backups: [...(await backups.list(context.site.key))] }
}
