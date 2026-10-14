import { createHollware } from '@hollware/server'
import config from '../hollware.config.ts'

// A Hollware project is this file: the config goes in, the Worker comes out.
const hollware = createHollware(config)

export default {
  fetch: hollware.fetch,
  scheduled: hollware.scheduled,
  queue: hollware.queue,
} satisfies ExportedHandler<Env>

/** What sites reach over a service binding: the four read-only methods of `HollwareRpc`. */
export class Hollware extends hollware.Hollware {}

// Not part of a Hollware project: a probe for the tests of this repository (see probe.ts).
export { Probe } from './probe.ts'
