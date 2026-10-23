import { describe, expect, it } from 'vite-plus/test'

import { parseWidths } from '../app/lib/media.ts'

const refused = { ok: false, min: 320, max: 8192, most: 4 }

describe('parseWidths', () => {
  it('reads the widths an owner types, smallest first and each once', () => {
    expect(parseWidths('1280, 640')).toEqual({ ok: true, widths: [640, 1280] })
    expect(parseWidths(' 960 480,960 ')).toEqual({ ok: true, widths: [480, 960] })
    expect(parseWidths('')).toEqual({ ok: true, widths: [] })
  })

  it('refuses what is no width, or too many', () => {
    expect(
      ['300', '9000', '640.5', '640px', '-640', '320 480 640 800 960'].map(parseWidths),
    ).toEqual(Array.from({ length: 6 }, () => refused))
  })
})
