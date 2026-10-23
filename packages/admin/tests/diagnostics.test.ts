import { describe, expect, it } from 'vite-plus/test'

import { diagnosticsOf } from '../app/lib/diagnostics.ts'

const TEXT = '---\ntitle: Hi\ndescription: x\n---\n\n# Hi\n\n![](a.png)\n'

const violation = (overrides: Record<string, unknown>) => ({
  contract: 'c',
  severity: 'error' as const,
  path: '',
  message: 'Something.',
  fix: 'Fix it.',
  ...overrides,
})

describe('diagnosticsOf', () => {
  it('puts each violation at its line, a field at its line, and the rest at the first line', () => {
    const verdict = {
      ok: false,
      phase: 'write' as const,
      errors: [violation({ contract: 'images-have-alt', path: '/body', line: 8 })],
      warnings: [
        violation({ contract: 'seo', severity: 'warning', path: '/frontmatter/description' }),
        violation({ contract: 'site', severity: 'warning', path: '' }),
      ],
      contractsHash: 'h',
    }

    expect(diagnosticsOf(TEXT, verdict)).toEqual([
      {
        from: 40,
        to: 50,
        severity: 'error',
        message: 'Something. Fix it.',
        source: 'images-have-alt',
      },
      { from: 14, to: 28, severity: 'warning', message: 'Something. Fix it.', source: 'seo' },
      { from: 0, to: 3, severity: 'warning', message: 'Something. Fix it.', source: 'site' },
    ])
    expect(TEXT.slice(40, 50)).toBe('![](a.png)')
    expect(TEXT.slice(14, 28)).toBe('description: x')
  })
})
