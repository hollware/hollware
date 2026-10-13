import { describe, expect, it } from 'vite-plus/test'

import { contentFixture } from '../../../../tests/fixtures/content.ts'
import { jsonProblem } from '../../src/markdown/json.ts'
import { accepted, refused, warmUpComark } from './support.ts'

// Fails when: `run` in src/markdown/process.ts stops turning a `YAMLException` into a
// `frontmatter-syntax` violation, reports the wrong line or column (LF and CRLF files count the
// frontmatter differently inside Comark), lets frontmatter through that is not a mapping, or lets
// through one that `jsonProblem` (src/markdown/json.ts) refuses: anchors and aliases (a bomb of
// nine levels is a value of 387 million nodes once written out, and `&a [*a]` is a cycle),
// non-finite numbers, values nested deeper than MAX_DEPTH; or `linesBeforeBody` miscounts the
// lines the frontmatter takes, which shifts every line of the body.

warmUpComark()

const YAML_FIX =
  'Put a space after every colon, indent nested keys with spaces (never tabs), quote any value that contains a colon, a hash or a bracket, and give each key only once.'
const MAPPING_FIX =
  'Start the file with a line of three dashes, one "key: value" line for each field and a closing line of three dashes. If the dashes at the top were meant as a horizontal rule, remove them or write *** instead.'

describe('frontmatter that parses', () => {
  it('is returned as YAML gave it, and is the frontmatter of the document too', async () => {
    const markdown = [
      '---',
      'title: A post',
      'count: 3',
      'ratio: 1.5',
      'flag: true',
      'nothing: null',
      'date: 2026-10-12',
      'tags:',
      '  - a',
      '  - b',
      'nested:',
      '  key: value',
      '---',
      '',
      'Body.',
    ].join('\n')
    const { frontmatter, document } = await accepted(markdown)
    expect(frontmatter).toStrictEqual({
      title: 'A post',
      count: 3,
      ratio: 1.5,
      flag: true,
      nothing: null,
      date: '2026-10-12',
      tags: ['a', 'b'],
      nested: { key: 'value' },
    })
    expect(document.frontmatter).toBe(frontmatter)
  })

  it('keeps `.inf` and `1e999` as the text they are, so that no number is not finite', async () => {
    const { frontmatter } = await accepted('---\na: .inf\nb: 1e999\n---\nBody.')
    expect(frontmatter).toStrictEqual({ a: '.inf', b: '1e999' })
  })

  it('keeps a key called __proto__ as a key, and pollutes nothing', async () => {
    const { frontmatter } = await accepted('---\n__proto__:\n  polluted: true\n---\nBody.')
    expect(Object.keys(frontmatter)).toStrictEqual(['__proto__'])
    expect(Object.getPrototypeOf(frontmatter)).toBe(Object.prototype)
    expect(Reflect.get(Object.prototype, 'polluted')).toBeUndefined()
  })

  it('is empty for a file without frontmatter, and for frontmatter that holds only null', async () => {
    expect((await accepted('Just a body.')).frontmatter).toStrictEqual({})
    expect((await accepted('---\nnull\n---\nBody.')).frontmatter).toStrictEqual({})
  })

  it('leaves an empty block of dashes to the body, where it is two horizontal rules', async () => {
    const { frontmatter, document } = await accepted('---\n---\nBody.')
    expect(frontmatter).toStrictEqual({})
    expect(document.nodes).toStrictEqual([
      ['hr', {}],
      ['hr', {}],
      ['p', {}, 'Body.'],
    ])
  })

  it('may use an anchor for a scalar, which is a copy of the text and shares nothing', async () => {
    const { frontmatter } = await accepted('---\na: &x hello\nb: *x\n---\nBody.')
    expect(frontmatter).toStrictEqual({ a: 'hello', b: 'hello' })
  })
})

describe('frontmatter YAML does not parse', () => {
  it('is a frontmatter-syntax violation that says the line and column of the file', async () => {
    const violations = await refused('---\ntitle: a\nlist: [unclosed\n---\nbody')
    expect(violations).toStrictEqual([
      {
        contract: 'frontmatter-syntax',
        severity: 'error',
        path: '/frontmatter',
        message:
          'The frontmatter is not valid YAML: unexpected end of the stream within a flow collection (line 3, column 16).',
        fix: `Fix the YAML between the two --- lines at the top of the file, at line 3. ${YAML_FIX}`,
        line: 3,
      },
    ])
  })

  it('counts the same line when the file ends its lines with CRLF', async () => {
    const violations = await refused('---\r\ntitle: a\r\nlist: [unclosed\r\n---\r\nbody')
    expect(violations[0]?.line).toBe(3)
    expect(violations[0]?.message).toBe(
      'The frontmatter is not valid YAML: unexpected end of the stream within a flow collection (line 3, column 16).',
    )
  })

  it('refuses the broken-frontmatter fixture, at the line YAML gives up on', async () => {
    const violations = await refused(contentFixture('hostile/broken-frontmatter.md'))
    expect(violations).toStrictEqual([
      {
        contract: 'frontmatter-syntax',
        severity: 'error',
        path: '/frontmatter',
        message: 'The frontmatter is not valid YAML: deficient indentation (line 3, column 1).',
        fix: `Fix the YAML between the two --- lines at the top of the file, at line 3. ${YAML_FIX}`,
        line: 3,
      },
    ])
  })

  it('refuses a duplicated key, a tab, a YAML tag that builds code, and nesting deeper than 100', async () => {
    const found = [
      await refused('---\na: 1\na: 2\n---\nbody'),
      await refused('---\n\ta: 1\n---\nbody'),
      await refused('---\na: !!js/function "function(){}"\n---\nbody'),
      await refused(`---\na: ${'['.repeat(101)}${']'.repeat(101)}\n---\nbody`),
    ].map((violations) => [violations[0]?.contract, violations[0]?.message])
    expect(found).toStrictEqual([
      [
        'frontmatter-syntax',
        'The frontmatter is not valid YAML: duplicated mapping key (line 3, column 1).',
      ],
      [
        'frontmatter-syntax',
        'The frontmatter is not valid YAML: end of the stream or a document separator is expected (line 2, column 3).',
      ],
      [
        'frontmatter-syntax',
        'The frontmatter is not valid YAML: unknown scalar tag !<tag:yaml.org,2002:js/function> (line 2, column 4).',
      ],
      [
        'frontmatter-syntax',
        'The frontmatter is not valid YAML: nesting exceeded maxDepth (100) (line 2, column 103).',
      ],
    ])
  })
})

describe('frontmatter that is not a mapping', () => {
  it('is refused with what the file starts with, and what to write', async () => {
    const found = []
    for (const markdown of [
      '---\nHello\n---\nbody',
      '---\n- a\n- b\n---\nbody',
      '---\n42\n---\nbody',
      '---\ntrue\n---\nbody',
    ]) {
      found.push((await refused(markdown))[0]?.message)
    }
    expect(found).toStrictEqual([
      'The frontmatter must be a YAML mapping of keys to values, but the file starts with text.',
      'The frontmatter must be a YAML mapping of keys to values, but the file starts with a list.',
      'The frontmatter must be a YAML mapping of keys to values, but the file starts with a number.',
      'The frontmatter must be a YAML mapping of keys to values, but the file starts with a boolean.',
    ])
    expect((await refused('---\nHello\n---\nbody'))[0]).toStrictEqual({
      contract: 'frontmatter-syntax',
      severity: 'error',
      path: '/frontmatter',
      message:
        'The frontmatter must be a YAML mapping of keys to values, but the file starts with text.',
      fix: MAPPING_FIX,
      line: 1,
    })
  })

  it('catches a horizontal rule at the top of a file, which opens frontmatter', async () => {
    const violations = await refused('---\n\nText\n\n---\n\nMore')
    expect(violations[0]?.message).toBe(
      'The frontmatter must be a YAML mapping of keys to values, but the file starts with text.',
    )
  })
})

describe('frontmatter that cannot be stored as JSON', () => {
  const ALIAS_MESSAGE =
    'The frontmatter holds a YAML anchor or alias, which Hollware does not store.'
  const ALIAS_FIX = 'Remove the &anchor and *alias markers and write every value out in full.'

  /** Nine arrays of nine references to the one before: 9^9 values once written out. */
  function bomb(): string {
    let yaml = 'a: &a ["x","x","x","x","x","x","x","x","x"]\n'
    let previous = 'a'
    for (const key of 'bcdefghij') {
      yaml += `${key}: &${key} [${Array(9).fill(`*${previous}`).join(',')}]\n`
      previous = key
    }
    return `---\n${yaml}---\nbody`
  }

  it('refuses an alias bomb without writing it out', async () => {
    expect(await refused(bomb())).toStrictEqual([
      {
        contract: 'frontmatter-syntax',
        severity: 'error',
        path: '/frontmatter',
        message: ALIAS_MESSAGE,
        fix: ALIAS_FIX,
        line: 1,
      },
    ])
  })

  it('refuses a cycle and a value that is shared, since JSON stores both as a copy', async () => {
    for (const markdown of ['---\na: &a [*a]\n---\nbody', '---\na: &x [1]\nb: *x\n---\nbody']) {
      expect((await refused(markdown))[0]?.message).toBe(ALIAS_MESSAGE)
    }
  })

  it('says what is wrong with each kind of value jsonProblem can find', () => {
    const cycle: unknown[] = []
    cycle.push(cycle)
    let deep: unknown = 'leaf'
    for (let level = 0; level < 101; level++) deep = [deep]
    let allowed: unknown = 'leaf'
    for (let level = 0; level < 100; level++) allowed = [allowed]
    const shared = { n: 1 }
    expect([
      jsonProblem({ a: 'text', b: 1.5, c: [true, null, { d: [] }] }),
      jsonProblem(cycle),
      jsonProblem([shared, shared]),
      jsonProblem({ a: Number.POSITIVE_INFINITY }),
      jsonProblem([Number.NaN]),
      jsonProblem({ a: undefined }),
      jsonProblem({ a: () => 1 }),
      jsonProblem({ a: new Date(0) }),
      jsonProblem({ a: new Map() }),
      jsonProblem({ a: 1n }),
      jsonProblem(deep),
      jsonProblem(allowed),
      jsonProblem(Object.create(null)),
    ]).toStrictEqual([
      undefined,
      'shared',
      'shared',
      'number',
      'number',
      'type',
      'type',
      'type',
      'type',
      'type',
      'depth',
      undefined,
      undefined,
    ])
  })
})

describe('the lines of the body', () => {
  it('start after the frontmatter, however its lines end', async () => {
    // The heading is on line 5 of the first three files and on line 6 of the last, whose frontmatter has two more lines. The carriage return that ends the closing fence belongs to the body.
    const files = [
      '---\ntitle: a\n---\n\n# Hi\n',
      '---\r\ntitle: a\r\n---\r\n\r\n# Hi\r\n',
      '---\r\ntitle: a\n---\n\n# Hi',
      '---\ntitle: a\ntags:\n  - b\n---\n# Hi',
    ]
    const lines = []
    for (const markdown of files) lines.push((await accepted(markdown)).extracted.headings[0]?.line)
    expect(lines).toStrictEqual([5, 5, 5, 6])
  })

  it('count a body that follows a second block of dashes as the body it is', async () => {
    const { document, extracted } = await accepted('---\na: 1\n---\nb: 2\n---\nbody')
    expect(document.frontmatter).toStrictEqual({ a: 1 })
    expect(extracted.headings).toStrictEqual([{ depth: 2, text: 'b: 2', id: 'b-2', line: 4 }])
  })
})
