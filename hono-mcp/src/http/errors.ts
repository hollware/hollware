import type { Env as HonoEnv, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

// Everything that differs between Hono 4 and Hono 5 error handling lives in this file.
//
// Hono 4: `app.onError((error, c) => Response)`. One handler per app, replaced by each call.
// Hono 5: `app.onError(async (c, next) => Response | next())`. `onError` registers error
//         *middleware*; the error is `c.error`; `await next()` falls through to the next error
//         middleware and finally to the built-in handler. Source: hono@5.0.0-rc.1
//         dist/hono-base.d.ts (`onError: FallbackHandlerInterface`) and dist/hono-base.js.

export type ErrorBody = { error: { status: number; message: string } }

/** The JSON body every error leaves the gateway with. */
export function errorBody(status: number, message: string): ErrorBody {
  return { error: { status, message } }
}

/** Turns HTTPException into a JSON error body, any other error into a JSON 500, and 404s into JSON. */
export function installErrorHandling<E extends HonoEnv>(app: Hono<E>): void {
  app.onError((c) => {
    const error = c.error
    if (error instanceof HTTPException) {
      // `res` set on the exception wins (for example a 401 with a WWW-Authenticate header).
      if (error.res) return error.getResponse()
      return c.json(errorBody(error.status, error.message), error.status)
    }
    console.error('unhandled error', error)
    return c.json(errorBody(500, 'Internal Server Error'), 500)
  })
  app.notFound((c) => c.json(errorBody(404, `No route for ${c.req.method} ${c.req.path}`), 404))
}
