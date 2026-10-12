// Calls a running copy of the Worker (vp dev, wrangler dev, ...) and compares what it answers with the
// literals of test/support/small-post.ts. Exit code 1 when anything differs.
//   node scripts/check-served.ts http://localhost:5220
import { isDeepStrictEqual } from 'node:util'
import { SMALL_POST } from '../src/fixtures.ts'
import {
  SMALL_POST_COMPONENTS,
  SMALL_POST_FRONTMATTER,
  SMALL_POST_HEADINGS,
  SMALL_POST_HTML,
  SMALL_POST_IMAGES,
  SMALL_POST_LINKS,
} from '../test/support/small-post.ts'

const base = process.argv[2] ?? 'http://localhost:5220'
const response = await fetch(`${base}/process`, { method: 'POST', body: SMALL_POST })
const body: unknown = await response.json()
const expected = {
  frontmatter: SMALL_POST_FRONTMATTER,
  extracted: {
    headings: SMALL_POST_HEADINGS,
    links: SMALL_POST_LINKS,
    images: SMALL_POST_IMAGES,
    components: SMALL_POST_COMPONENTS,
    words: 82,
  },
  html: SMALL_POST_HTML,
}
const runtime: unknown = await (await fetch(`${base}/runtime`)).json()
console.log(
  `POST /process -> ${response.status}, identical to the literals: ${isDeepStrictEqual(body, expected)}`,
)
console.log(`GET /runtime -> ${JSON.stringify(runtime)}`)
process.exitCode = isDeepStrictEqual(body, expected) ? 0 : 1
