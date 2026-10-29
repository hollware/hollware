import type { OperationByName, OperationName } from '@hollware/core'
import type * as z from 'zod'

export type OperationInput<Name extends OperationName> = z.input<OperationByName<Name>['input']>
export type OperationOutput<Name extends OperationName> = z.output<OperationByName<Name>['output']>

/** A service binding to the `HollwareOps` entrypoint of a Hollware Worker. */
export interface OpsBinding {
  ops(name: string, input: unknown, options: { readonly token: string }): Promise<unknown>
}

export interface OpsClientOptions {
  /** The service binding to the `HollwareOps` entrypoint. */
  readonly binding: unknown
  /** A personal token (`hw_pat_…`): every call runs as it, on its site. */
  readonly token: string
}

/** Every operation of Hollware, run over a service binding as one personal token. */
export interface OpsClient {
  call<Name extends OperationName>(
    name: Name,
    input: OperationInput<Name>,
  ): Promise<OperationOutput<Name>>
}

function isOpsBinding(value: unknown): value is OpsBinding {
  return typeof value === 'object' && value !== null && 'ops' in value
}

/**
 * The operations of a Hollware over a service binding to its `HollwareOps` entrypoint, run as the
 * personal token given: `createOpsClient({ binding: env.HOLLWARE_OPS, token: env.HOLLWARE_TOKEN })`.
 */
export function createOpsClient(options: OpsClientOptions): OpsClient {
  const { binding, token } = options
  if (!isOpsBinding(binding)) {
    throw new Error(
      'Hollware: the binding is no service binding to the HollwareOps entrypoint: add one to services in wrangler.jsonc, with "entrypoint": "HollwareOps".',
    )
  }
  return {
    call: async <Name extends OperationName>(name: Name, input: OperationInput<Name>) =>
      (await binding.ops(name, input, { token })) as OperationOutput<Name>,
  }
}
