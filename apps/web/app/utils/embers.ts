export const MARK_PATH =
  'M109.3 17.8 C101.9 25.0 98.5 35.8 100.9 44.7 C102.3 49.9 108.5 57.8 114.2 61.7 C139.7 79.0 149.8 88.1 158.8 102.0 C167.7 115.8 173.7 137.1 172.5 150.5 C170.4 172.6 163.0 189.2 148.6 203.6 C137.8 214.3 126.3 221.1 112.9 224.5 C104.2 226.8 104.0 226.4 111.5 221.4 C119.6 216.2 123.8 212.3 128.5 206.0 C133.9 198.6 136.9 189.4 132.7 192.8 C129.7 195.3 117.7 201.0 115.5 201.0 C114.2 201.0 111.7 202.5 109.7 204.5 C105.3 208.9 103.4 208.9 101.6 204.5 C101.1 203.33 100.6 202.17 100.1 201.0 C97.13 201.0 94.17 201.0 91.2 201.0 C88.27 201.0 85.33 201.0 82.4 201.0 C81.83 202.17 81.27 203.33 80.7 204.5 C79.8 206.4 78.5 208.0 77.9 208.0 C77.2 208.0 75.0 206.2 73.0 204.0 C70.9 201.7 68.4 200.0 67.1 200.0 C64.1 200.0 53.0 195.3 50.4 192.9 C47.6 190.3 46.7 190.5 47.5 193.7 C49.8 203.2 61.9 216.2 74.3 222.7 C78.8 225.0 76.1 225.5 69.3 223.5 C44.9 216.4 23.5 195.2 17.6 172.3 C15.6 164.8 15.6 151.3 17.4 144.3 C20.6 132.5 32.0 117.3 42.1 111.4 C45.1 109.7 51.3 106.1 55.9 103.4 C60.4 100.7 65.8 97.0 67.7 95.1 C68.9 93.93 70.1 92.77 71.3 91.6 C71.07 93.2 70.83 94.8 70.6 96.4 C70.2 99.0 68.7 104.1 67.4 107.8 C60.6 125.7 64.4 137.8 78.3 142.5 C82.3 143.8 83.2 143.8 86.6 142.4 C88.8 141.5 92.4 139.0 94.8 136.7 C102.1 129.6 103.7 119.4 100.0 103.5 C97.4 92.6 92.8 83.5 84.6 73.5 C76.5 63.7 74.5 58.3 75.3 49.3 C76.6 35.8 89.3 21.7 105.4 16.0 C113.0 13.3 113.7 13.6 109.3 17.8 Z M137.2 151.8 C131.3 160.9 124.4 166.8 109.2 175.9 C100.9 180.9 100.3 181.5 102.1 183.7 C106.2 188.6 121.0 191.0 129.2 188.1 C138.2 185.1 145.0 174.2 145.0 163.0 C145.0 158.1 142.6 148.5 141.1 147.5 C140.6 147.3 138.8 149.1 137.2 151.8 Z M41.2 155.2 C38.6 162.7 38.5 164.9 40.6 171.9 C43.2 180.8 51.5 188.1 60.8 189.6 C69.1 190.9 81.0 186.3 81.0 181.7 C81.0 181.0 79.3 179.6 77.3 178.6 C68.6 174.5 54.8 163.8 50.4 157.8 C48.0 154.5 46.0 151.2 46.0 150.4 C46.0 149.6 45.4 149.0 44.7 149.0 C44.0 149.0 42.4 151.8 41.2 155.2 Z'

export const MARK_WIDTH = 204
export const MARK_HEIGHT = 243

export function eyePaths(path: string = MARK_PATH): readonly [string, string] {
  const parts = path.split(/(?=M)/).map((part) => part.trim())
  const right = parts[1]
  const left = parts[2]
  if (right === undefined || left === undefined) throw new Error('the mark has no eyes')
  return [left, right]
}

export interface Ember {
  homeX: number
  homeY: number
  x: number
  y: number
  vx: number
  vy: number
  size: number
  heat: number
  phase: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

export function embersOf(points: readonly Point[], random: () => number): Ember[] {
  return points.map((point) => ({
    homeX: point.x,
    homeY: point.y,
    x: point.x + (random() - 0.5) * 40,
    y: point.y + (random() - 0.5) * 40,
    vx: 0,
    vy: 0,
    size: 1.1 + random() * 1.5,
    heat: random(),
    phase: random() * Math.PI * 2,
  }))
}

export interface Pull {
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly strength: number
}

export function stepEmber(ember: Ember, pull: Pull | null, spring = 0.055, damping = 0.86): void {
  ember.vx += (ember.homeX - ember.x) * spring
  ember.vy += (ember.homeY - ember.y) * spring
  if (pull !== null) {
    const dx = ember.x - pull.x
    const dy = ember.y - pull.y
    const distance = Math.hypot(dx, dy)
    if (distance > 0 && distance < pull.radius) {
      const push = (1 - distance / pull.radius) * pull.strength
      ember.vx += (dx / distance) * push
      ember.vy += (dy / distance) * push
    }
  }
  ember.vx *= damping
  ember.vy *= damping
  ember.x += ember.vx
  ember.y += ember.vy
}

export type Tint = readonly [number, number, number] | null

export const TINTS = {
  alarm: [229, 72, 77],
  cloud: [243, 128, 32],
  cloudLight: [251, 173, 65],
} as const

export function emberColor(
  heat: number,
  glow: number,
  strength = 1,
  tint: Tint = null,
  amount = 0,
): string {
  const hot = Math.min(1, Math.max(0, heat * 0.7 + glow * 0.3))
  const mix = (from: number, to: number) => Math.round(from + (to - from) * amount)
  const red = tint === null ? 246 : mix(246, tint[0])
  const green =
    tint === null ? Math.round(120 + hot * 110) : mix(Math.round(120 + hot * 110), tint[1])
  const blue = tint === null ? Math.round(40 + hot * 120) : mix(Math.round(40 + hot * 120), tint[2])
  const alpha = ((0.6 + hot * 0.4) * strength).toFixed(3)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function hop(from: number, to: number, progress: number): number {
  const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2
  return from + (to - from) * eased
}

export function arc(progress: number, height: number): number {
  return Math.sin(Math.PI * Math.min(1, Math.max(0, progress))) * height
}

export type Shape = 'flame' | 'check' | 'cloudflare'

export interface Beat {
  readonly shape: Shape
  readonly step: number
  readonly tint: 'alarm' | 'cloud' | null
  readonly shake: boolean
  readonly glyphs: boolean
  readonly sparks: boolean
}

const CALM: Beat = {
  shape: 'flame',
  step: 0,
  tint: null,
  shake: false,
  glyphs: false,
  sparks: false,
}

function alternate(seconds: number, flame: number, shape: number): boolean {
  return seconds % (flame + shape) >= flame
}

export function beatOf(section: string, seconds: number): Beat {
  switch (section) {
    case 'agents':
      return { ...CALM, glyphs: true }
    case 'cms':
      return { ...CALM, step: Math.floor(seconds / 0.9) }
    case 'contracts': {
      const fixed = Math.floor(seconds / 2.6) % 2 === 1
      return fixed
        ? { ...CALM, shape: 'check', step: 1 }
        : { ...CALM, tint: 'alarm', shake: true, sparks: true }
    }
    case 'admin': {
      const press = seconds % 3.6 >= 2.4
      return { ...CALM, step: press ? 1 : 0, sparks: press }
    }
    case 'cloudflare':
      return {
        ...CALM,
        shape: alternate(seconds, 1.2, 2.8) ? 'cloudflare' : 'flame',
        tint: 'cloud',
        sparks: true,
      }
    case 'faq':
      return { ...CALM, step: Math.floor(seconds / 2.8) }
    case 'cta':
      return { ...CALM, glyphs: true }
    default:
      return CALM
  }
}

export function flicker(px: number, py: number, phase: number, seconds: number): Point {
  const height = Math.max(0, 1 - py / MARK_HEIGHT) ** 1.6
  return {
    x: Math.sin(seconds * 3.1 + py * 0.09 + phase * 4) * 6 * height,
    y: -Math.abs(Math.sin(seconds * 2.3 + px * 0.05 + phase * 3)) * 9 * height,
  }
}
