// S1b probe: runs the same scenarios against Hono 4.13.13 (found in the pnpm store because the
// conformance package pulls @hono/node-server) and Hono 5.0.0-rc.1 (the spike dependency), and
// prints what each does. Not a test: it documents behavior differences.
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const store = resolve(import.meta.dirname, '../../../node_modules/.pnpm')
const load = async (dir) => {
  const root = resolve(store, dir, 'node_modules/hono/dist')
  const index = await import(pathToFileURL(resolve(root, 'index.js')).href)
  const exception = await import(pathToFileURL(resolve(root, 'http-exception.js')).href)
  return { Hono: index.Hono, HTTPException: exception.HTTPException }
}

const versions = {
  'hono 4.13.13': await load('hono@4.13.13'),
  'hono 5.0.0-rc.1': await load('hono@5.0.0-rc.1'),
}

const describeResponse = async (response) =>
  `${response.status} ${(await response.text()).slice(0, 120)}`
const attempt = async (fn) => {
  try {
    return await fn()
  } catch (error) {
    return `THROWS ${error.constructor.name}: ${error.message}`
  }
}

const silence = console.error
console.error = () => {}

for (const [label, { Hono, HTTPException }] of Object.entries(versions)) {
  console.log(`\n### ${label}`)

  // 1. Hono 4 style handler: (err, c) => Response.
  {
    const app = new Hono()
    app.get('/boom', () => {
      throw new HTTPException(409, { message: 'conflict' })
    })
    app.onError((err, c) => c.json({ viaOldStyle: String(err.message ?? err) }, 500))
    console.log(
      '1. onError((err, c) => c.json(...)):',
      await attempt(async () => describeResponse(await app.request('/boom'))),
    )
  }

  // 2. Hono 5 style handler: (c, next) with c.error.
  {
    const app = new Hono()
    app.get('/boom', () => {
      throw new HTTPException(409, { message: 'conflict' })
    })
    app.onError((c) => c.json({ viaNewStyle: String(c.error?.message) }, 500))
    console.log(
      '2. onError((c) => c.json(c.error...)):',
      await attempt(async () => describeResponse(await app.request('/boom'))),
    )
  }

  // 3. Two onError calls: replace (4) or both registered as middleware (5).
  {
    const app = new Hono()
    app.get('/boom', () => {
      throw new Error('x')
    })
    let first = 0
    app.onError((errOrC, cOrNext) => {
      first++
      return typeof cOrNext === 'function' ? cOrNext() : undefined
    })
    app.onError((_errOrC) => new Response(`second (first ran ${first}x)`, { status: 500 }))
    console.log(
      '3. two onError calls:',
      await attempt(async () => describeResponse(await app.request('/boom'))),
    )
  }

  // 4. notFound with the 4-style signature (c) => Response, which is also the 5-style.
  {
    const app = new Hono()
    app.notFound((c) => c.json({ notFound: c.req.path }, 404))
    console.log(
      '4. notFound((c) => c.json(...)):',
      await attempt(async () => describeResponse(await app.request('/missing'))),
    )
  }

  // 5. Removed APIs.
  {
    const app = new Hono()
    console.log('5a. typeof app.mount:', typeof app.mount, '| typeof app.fire:', typeof app.fire)
    const seen = {}
    app.get('/p/:id', (c) => {
      seen.routePath = c.req.routePath
      seen.matchedRoutes = typeof c.req.matchedRoutes
      return c.text('ok')
    })
    await app.request('/p/1')
    console.log('5b. c.req.routePath / typeof c.req.matchedRoutes:', JSON.stringify(seen))
  }

  // 6. A thrown string.
  {
    const app = new Hono()
    app.get('/s', () => {
      throw 'a string'
    })
    app.onError((...args) => {
      const c = args.length === 2 && typeof args[1] === 'function' ? args[0] : args[1]
      return c.json(
        {
          errorClass: (c.error ?? args[0])?.constructor?.name,
          message: String((c.error ?? args[0])?.message),
        },
        500,
      )
    })
    console.log(
      '6. throw "a string":',
      await attempt(async () => describeResponse(await app.request('/s'))),
    )
  }

  // 7. Sub app with its own error handling, mounted with route().
  {
    const sub = new Hono()
    sub.get('/boom', () => {
      throw new Error('sub boom')
    })
    sub.onError((...args) => {
      const c = typeof args[1] === 'function' ? args[0] : args[1]
      return c.json({ handledBy: 'sub' }, 500)
    })
    const parent = new Hono()
    parent.get('/parent-boom', () => {
      throw new Error('parent boom')
    })
    parent.route('/api', sub)
    const sub2 = await attempt(async () => describeResponse(await parent.request('/api/boom')))
    const own = await attempt(async () => describeResponse(await parent.request('/parent-boom')))
    console.log(
      '7. sub.onError via parent.route("/api", sub): /api/boom ->',
      sub2,
      '| /parent-boom ->',
      own,
    )
  }

  // 7b-7e. Error and not-found handling across route() boundaries. The handler is written to work in both
  // versions: Hono 4 calls (err, c), Hono 5 calls (c, next) with the error in c.error.
  {
    const respond =
      (label) =>
      (...args) => {
        const c = typeof args[1] === 'function' ? args[0] : args[1]
        return c.json({ handledBy: label }, 500)
      }
    const run = async (parent, path) =>
      attempt(async () => describeResponse(await parent.request(path)))

    // B. both define onError: sub wins on its routes, parent elsewhere.
    {
      const sub = new Hono()
      sub.get('/boom', () => {
        throw new Error('x')
      })
      sub.onError(respond('sub'))
      const parent = new Hono()
      parent.get('/own', () => {
        throw new Error('x')
      })
      parent.onError(respond('parent'))
      parent.route('/api', sub)
      console.log(
        '7b. sub and parent both onError: /api/boom ->',
        await run(parent, '/api/boom'),
        '| /own ->',
        await run(parent, '/own'),
      )
    }
    // A. only the parent defines onError (before route()).
    {
      const sub = new Hono()
      sub.get('/boom', () => {
        throw new Error('x')
      })
      const parent = new Hono()
      parent.onError(respond('parent'))
      parent.route('/api', sub)
      console.log(
        '7c. only parent onError (set before route()): /api/boom ->',
        await run(parent, '/api/boom'),
      )
    }
    // A'. only the parent defines onError (after route()).
    {
      const sub = new Hono()
      sub.get('/boom', () => {
        throw new Error('x')
      })
      const parent = new Hono()
      parent.route('/api', sub)
      parent.onError(respond('parent'))
      console.log(
        '7d. only parent onError (set after route()): /api/boom ->',
        await run(parent, '/api/boom'),
      )
    }
    // C. sub defines onError after being mounted.
    {
      const sub = new Hono()
      sub.get('/boom', () => {
        throw new Error('x')
      })
      const parent = new Hono()
      parent.route('/api', sub)
      sub.onError(respond('sub-late'))
      console.log(
        '7e. sub onError registered after parent.route(): /api/boom ->',
        await run(parent, '/api/boom'),
      )
    }
    // D. notFound defined on the sub-app.
    {
      const sub = new Hono()
      sub.get('/known', (c) => c.text('known'))
      sub.notFound((c) => c.json({ notFoundFrom: 'sub' }, 404))
      const parent = new Hono()
      parent.route('/api', sub)
      console.log(
        '7f. sub.notFound via parent.route(): /api/missing ->',
        await run(parent, '/api/missing'),
        '| /elsewhere ->',
        await run(parent, '/elsewhere'),
      )
    }
  }

  // 8. c.req.json() default type is only a typing change; runtime check of query typing is skipped.
  // 9. Context members are accessors in 5.
  {
    const app = new Hono()
    let descriptor
    app.get('/d', (c) => {
      descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(c), 'json')
        ? 'accessor on prototype'
        : 'own property'
      return c.text('ok')
    })
    await app.request('/d')
    console.log('9. c.json is:', descriptor)
  }
}

console.error = silence
