export const name = '@hollware/agents'

export type { AgentGrant, HollwareAgentRpc, HollwareEvent } from '@hollware/core'

export {
  audit,
  auditStep,
  writeReport,
  type AuditOptions,
  type Finding,
  type ReportOptions,
} from './auditor.ts'
export {
  allowOnly,
  grantHollware,
  mcpHollware,
  type AllowedTool,
  type Hollware,
} from './hollware.ts'
export { mapMemory, type Memory } from './memory.ts'
export { type Message, type Model } from './model.ts'
export { reviewById, reviewPending } from './reviewer.ts'
export { translateMissing } from './translator.ts'
export {
  createHollwareAgents,
  roleAt,
  type AgentsEnv,
  type AgentsOptions,
  type AgentsWorker,
} from './worker.ts'
