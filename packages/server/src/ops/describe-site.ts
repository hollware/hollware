import { describeBuiltInContracts, describeResolvedSite } from '@hollware/core'
import type { OperationHandler } from './types.ts'

/**
 * The always-on contracts as every collection lists them, described once for the isolate:
 * `describeResolvedSite` memoizes a site's description by the array it is given, so passing this
 * same array on every call is what makes the schemas convert once and not on every request.
 */
const builtInContracts = describeBuiltInContracts()

/** Describes the site the call is for: what an agent reads before it writes. */
export const describeSite: OperationHandler<'describe_site'> = async (_input, context) => ({
  outcome: 'ok',
  site: describeResolvedSite(context.site, { builtInContracts }),
})
