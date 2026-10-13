/**
 * The HTTP gateway: what `compose.ts` mounts as the `fetch` of the Worker. `createGateway` builds
 * the Hono 5 app (guard, health, token check, MCP route, JSON errors); the log entries it writes
 * are typed here for whoever reads them.
 */
export { createGateway, type Gateway, type GatewayOptions } from './gateway.ts'
export type { AuthRefusedLog, GatewayLogEntry, RequestErrorLog } from './types.ts'
