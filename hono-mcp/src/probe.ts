import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv'
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker'
import * as z from 'zod'

// S2c probe, not part of the product: what a REAL workerd (vp dev / wrangler dev) allows. The vitest
// workerd runtime is not enough: it lets `new Function` through, production does not.

const schema = {
  type: 'object',
  properties: { a: { type: 'string' } },
  required: ['a'],
} as const

function attempt(fn: () => unknown): unknown {
  try {
    return { ok: fn() }
  } catch (error) {
    return {
      threw: error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error),
    }
  }
}

export default {
  fetch(request) {
    const { pathname } = new URL(request.url)
    switch (pathname) {
      case '/function':
        // oxlint-disable-next-line typescript/no-implied-eval -- the probe exists to hit this
        return Response.json(attempt(() => new Function('return 1 + 1')()))
      case '/eval':
        // oxlint-disable-next-line no-eval -- the probe exists to hit this
        return Response.json(attempt(() => (0, eval)('1 + 1')))
      case '/ajv':
        return Response.json(
          attempt(() => new AjvJsonSchemaValidator().getValidator(schema)({ a: 1 })),
        )
      case '/cfworker':
        return Response.json(
          attempt(() => new CfWorkerJsonSchemaValidator().getValidator(schema)({ a: 1 })),
        )
      case '/zod':
        return Response.json(attempt(() => z.object({ a: z.string() }).safeParse({ a: 1 }).success))
      case '/globals': {
        const globals: Record<string, unknown> = globalThis
        return Response.json({
          process: typeof globals.process,
          Buffer: typeof globals.Buffer,
          setImmediate: typeof globals.setImmediate,
        })
      }
      case '/navigator':
        return Response.json({ userAgent: navigator.userAgent })
      default:
        return new Response('Not Found', { status: 404 })
    }
  },
} satisfies ExportedHandler<Env>
