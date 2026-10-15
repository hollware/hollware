export const name = '@hollware/agents'

export { audit, reportOf, type AuditOptions, type Finding, type ReportOptions } from './auditor.ts'
export {
  ALLOWED_TOOLS,
  allowOnly,
  mcpHollware,
  type AllowedTool,
  type Hollware,
} from './hollware.ts'
export { kvMemory, mapMemory, type Memory } from './memory.ts'
export {
  capped,
  DailyLimitReached,
  DEFAULT_MODEL,
  workersAiModel,
  type Message,
  type Model,
} from './model.ts'
export { AGENTS_CLIENT, reviewPending } from './reviewer.ts'
export { slugOf, translateMissing } from './translator.ts'
export {
  AUDIT_CRON,
  createHollwareAgents,
  type AgentsEnv,
  type AgentsOptions,
  type AgentsWorker,
} from './worker.ts'
