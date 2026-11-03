import { describe, expect, it } from 'vite-plus/test'

import {
  arc,
  emberColor,
  embersOf,
  eyePaths,
  hop,
  MARK_PATH,
  beatOf,
  flicker,
  stepEmber,
  TINTS,
} from '../app/utils/embers.ts'

describe('the embers of the mark', () => {
  it('find the two eyes of the mark', () => {
    expect(MARK_PATH.startsWith('M109.3 17.8')).toBe(true)
    const [left, right] = eyePaths()
    expect(left.startsWith('M41.2 155.2')).toBe(true)
    expect(right.startsWith('M137.2 151.8')).toBe(true)
  })

  it('spring back to the mark, and give way to a pull near them only', () => {
    const [ember] = embersOf([{ x: 0, y: 0 }], () => 0.5)
    if (ember === undefined) throw new Error('no ember')
    expect([ember.x, ember.y, ember.size]).toEqual([0, 0, 1.85])
    ember.x = 10
    stepEmber(ember, null)
    expect(ember.x).toBeCloseTo(9.527, 3)
    const far = { ...ember, x: 0, y: 0, vx: 0, vy: 0 }
    stepEmber(far, { x: 200, y: 0, radius: 100, strength: 4 })
    expect(far.x).toBe(0)
    const near = { ...ember, x: 0, y: 0, vx: 0, vy: 0 }
    stepEmber(near, { x: 50, y: 0, radius: 100, strength: 4 })
    expect(near.x).toBeCloseTo(-1.72, 3)
  })

  it('glow from amber to near white as they heat', () => {
    expect(emberColor(0, 0)).toBe('rgba(246, 120, 40, 0.600)')
    expect(emberColor(1, 1)).toBe('rgba(246, 230, 160, 1.000)')
    expect(emberColor(1, 1, 0.1)).toBe('rgba(246, 230, 160, 0.100)')
    expect(emberColor(1, 1, 1, TINTS.alarm, 1)).toBe('rgba(229, 72, 77, 1.000)')
    expect(emberColor(1, 1, 1, TINTS.cloud, 0.5)).toBe('rgba(245, 179, 96, 1.000)')
  })

  it('hop between sections along an eased arc that lands where it aims', () => {
    expect([0, 0.25, 0.5, 1].map((progress) => hop(0, 100, progress))).toEqual([0, 12.5, 50, 100])
    expect(arc(0, 140)).toBe(0)
    expect(arc(0.5, 140)).toBe(140)
    expect(arc(1.4, 140)).toBeCloseTo(0, 10)
  })
})

describe('what the head does in each section', () => {
  it('writes in agents, walks the cards, fixes a write, reads a review, doubts and works as an agent', () => {
    expect(beatOf('agents', 3).glyphs).toBe(true)
    expect([0, 0.95, 1.85, 9].map((seconds) => beatOf('cms', seconds).step)).toEqual([0, 1, 2, 10])
    expect(beatOf('contracts', 1)).toEqual({
      shape: 'flame',
      step: 0,
      tint: 'alarm',
      shake: true,
      glyphs: false,
      sparks: true,
    })
    expect(beatOf('contracts', 3).shape).toBe('check')
    expect([1, 2.5, 3.7].map((seconds) => beatOf('admin', seconds).step)).toEqual([0, 1, 0])
    expect([beatOf('cloudflare', 1).shape, beatOf('cloudflare', 2).shape]).toEqual([
      'flame',
      'cloudflare',
    ])
    expect(beatOf('cloudflare', 1).tint).toBe('cloud')
    expect([0, 2.9, 6].map((seconds) => beatOf('faq', seconds).step)).toEqual([0, 1, 2])
    expect(beatOf('faq', 1).shape).toBe('flame')
    expect(beatOf('cta', 1).glyphs).toBe(true)
    expect(beatOf('hero', 2)).toEqual(beatOf('somewhere', 2))
    expect(beatOf('hero', 2).shape).toBe('flame')
  })

  it('flickers the top of the flame and keeps its base still', () => {
    const base = flicker(100, 243, 0.3, 1.2)
    const tip = flicker(100, 20, 0.3, 1.2)
    expect([base.x, base.y]).toEqual([0, -0])
    expect(Math.abs(tip.x) + Math.abs(tip.y)).toBeGreaterThan(1)
  })
})
