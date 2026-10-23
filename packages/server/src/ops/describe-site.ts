import { describeBuiltInContracts, describeResolvedSite } from '@hollware/core'
import type { OperationHandler } from './types.ts'

const builtInContracts = describeBuiltInContracts()

export const describeSite: OperationHandler<'describe_site'> = async (_input, context) => ({
  outcome: 'ok',
  site: describeResolvedSite(context.site, { builtInContracts }),
})
