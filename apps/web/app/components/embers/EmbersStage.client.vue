<script setup lang="ts">
interface Head {
  x: number
  y: number
  scale: number
  turn: number
}

interface Spot {
  readonly key: string
  readonly x: number
  readonly y: number
  readonly scale: number
}

interface Glyph {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  text: string
}

const COUNT = 2200
const HOP_MS = 760
const MOUTH = { x: 102, y: 200 }
const GLYPHS = ['#', '<', '/>', '*', '-', '[', ']', '`', 'md', '{', '}', '>']

const live = useState('embers-live', () => false)
const surface = ref<HTMLCanvasElement | null>(null)

let shapes: Record<Shape, Point[]> = { flame: [], check: [], cloudflare: [] }
let lightCloud: boolean[] = []
let squash = 0
let pressed = ''
let embers: Ember[] = []
let sparks: Ember[] = []
let glyphs: Glyph[] = []
let frame = 0
let ratio = 1
let width = 0
let height = 0
let pointer: { x: number; y: number } | null = null
let burst: { x: number; y: number; until: number } | null = null
let section = 'hero'
let sections: Element[] = []
let observer: IntersectionObserver | null = null
let since = 0
let act = ''
let lastEmit = 0
let flight: { from: Head; key: string; start: number } | null = null
let landed = ''
let shape: Shape = 'flame'
let previous: Shape = 'flame'
let morphStart = 0
let lit: Element | null = null
let pulse = 1
let lift = 0
const head: Head = { x: 0, y: 0, scale: 0, turn: 0 }

function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function sampleShape(paint: (context: CanvasRenderingContext2D) => void, count: number): Point[] {
  const zoom = 4
  const shape = document.createElement('canvas')
  shape.width = MARK_WIDTH * zoom
  shape.height = MARK_HEIGHT * zoom
  const context = shape.getContext('2d')
  if (context === null) return []
  context.scale(zoom, zoom)
  paint(context)
  const pixels = context.getImageData(0, 0, shape.width, shape.height).data
  let filled = 0
  for (let index = 3; index < pixels.length; index += 4) if ((pixels[index] ?? 0) > 128) filled++
  const step = Math.max(1, Math.sqrt(filled / count))
  const random = seededRandom(7)
  const points: Point[] = []
  for (let y = 0; y < shape.height; y += step) {
    for (let x = 0; x < shape.width; x += step) {
      const px = x + (random() - 0.5) * step
      const py = y + (random() - 0.5) * step
      const at = (Math.floor(py) * shape.width + Math.floor(px)) * 4 + 3
      if ((pixels[at] ?? 0) > 128) points.push({ x: px / zoom, y: py / zoom })
    }
  }
  return points
}

function fitted<P extends Point>(points: P[], count: number, seed: number): (P | Point)[] {
  if (points.length === 0) return []
  const random = seededRandom(seed)
  const shuffled = points
    .map((point) => ({ point, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map(({ point }) => point)
  return Array.from(
    { length: count },
    (_, index) => shuffled[index % shuffled.length] ?? { x: 0, y: 0 },
  )
}

function buildShapes() {
  const flame = sampleShape((context) => context.fill(new Path2D(MARK_PATH), 'evenodd'), COUNT)
  const count = flame.length
  const check = sampleShape((context) => {
    context.lineWidth = 34
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.stroke(new Path2D('M38 132 L86 182 L170 70'))
  }, count)
  const big = sampleShape((context) => {
    context.beginPath()
    context.arc(98, 132, 50, Math.PI, 0)
    context.arc(150, 150, 28, Math.PI * 1.25, 0)
    context.lineTo(178, 178)
    context.lineTo(26, 178)
    context.arc(44, 160, 20, Math.PI * 0.5, Math.PI * 1.5)
    context.closePath()
    context.fill()
  }, count)
  const small = sampleShape(
    (context) => {
      context.beginPath()
      context.arc(168, 158, 22, Math.PI, 0)
      context.lineTo(196, 178)
      context.lineTo(140, 178)
      context.closePath()
      context.fill()
    },
    Math.round(count * 0.25),
  )
  const cloud = fitted(
    [
      ...big.map((point) => ({ ...point, light: false })),
      ...small.map((point) => ({ ...point, light: true })),
    ],
    count,
    5,
  )
  lightCloud = cloud.map((point) => 'light' in point && point.light === true)
  shapes = {
    flame,
    check: fitted(check, count, 3),
    cloudflare: cloud,
  }
}

function resize() {
  if (surface.value === null) return
  ratio = window.devicePixelRatio || 1
  width = Math.round(window.innerWidth * ratio)
  height = Math.round(window.innerHeight * ratio)
  surface.value.width = width
  surface.value.height = height
}

const narrow = () => window.innerWidth < 768
const smallScale = () => ((narrow() ? 58 : 96) / MARK_HEIGHT) * ratio

function slotSpot(name: 'hero' | 'cta'): Spot | null {
  const box = document.querySelector(`[data-ember-slot="${name}"]`)?.getBoundingClientRect()
  if (box === undefined || box.height === 0) return null
  if (box.bottom < window.innerHeight * 0.3 || box.top > window.innerHeight * 0.8) return null
  return {
    key: name,
    x: (box.left + box.width / 2) * ratio,
    y: (box.top + box.height / 2) * ratio,
    scale: ((box.height * 0.8) / MARK_HEIGHT) * ratio,
  }
}

function besideTitle(key: string, element: Element | undefined): Spot {
  const title = element?.querySelector(narrow() ? '.page-chapter' : 'h2')?.getBoundingClientRect()
  const box = element?.getBoundingClientRect()
  const x = narrow()
    ? window.innerWidth - 44
    : Math.min(window.innerWidth - 120, (box?.right ?? window.innerWidth) - 140)
  const y = title === undefined ? window.innerHeight / 2 : title.top + title.height / 2
  return {
    key,
    x: x * ratio,
    y: Math.min(window.innerHeight - 70, Math.max(100, y)) * ratio,
    scale: smallScale(),
  }
}

function over(key: string, element: Element | null | undefined, fallback: Spot): Spot {
  const box = element?.getBoundingClientRect()
  if (box === undefined || box.bottom < 80 || box.top > window.innerHeight - 40) return fallback
  return {
    key,
    x: Math.min(window.innerWidth - 40, box.right - 18) * ratio,
    y: Math.max(90, box.top + 6) * ratio,
    scale: smallScale(),
  }
}

function light(card: Element | null) {
  if (lit === card) return
  lit?.classList.remove('page-card-lit')
  card?.classList.add('page-card-lit')
  lit = card
}

function direct(seconds: number): { spot: Spot; beat: Beat } {
  const hero = slotSpot('hero')
  if (hero !== null) return { spot: hero, beat: beatOf('hero', seconds) }
  const cta = slotSpot('cta')
  if (cta !== null) return { spot: cta, beat: beatOf('cta', seconds) }
  const element = sections.find((candidate) => candidate.getAttribute('id') === section)
  const beside = besideTitle(section, element)
  const beat = beatOf(section, seconds)
  if (section === 'cms') {
    const cards = [...(element?.querySelectorAll('.page-card') ?? [])]
    const index = beat.step % Math.max(1, cards.length)
    const card = cards[index] ?? null
    light(card)
    return { spot: over(`cms:${index}`, card, beside), beat }
  }
  light(null)
  if (section === 'contracts') {
    const box = element?.querySelector(beat.step === 1 ? '.chaos-after' : '.chaos-before')
    return { spot: over(`contracts:${beat.step}`, box, beside), beat }
  }
  if (section === 'admin') {
    const image = element?.querySelector('img')?.getBoundingClientRect()
    if (image !== undefined && image.top < window.innerHeight * 0.75 && image.bottom > 140) {
      if (beat.step === 1) {
        return {
          spot: {
            key: 'admin:press',
            x: (image.left + image.width * 0.9) * ratio,
            y: Math.max(110, image.top + image.height * 0.05) * ratio,
            scale: smallScale(),
          },
          beat,
        }
      }
      const progress = (((performance.now() - since) / 1000) % 3.6) / 2.4
      return {
        spot: {
          key: 'admin:read',
          x: (image.left + image.width * (0.5 + 0.42 * progress)) * ratio,
          y:
            Math.max(
              110,
              image.top + image.height * (0.3 + 0.05 * Math.sin(progress * Math.PI * 6)),
            ) * ratio,
          scale: smallScale(),
        },
        beat,
      }
    }
  }
  if (section === 'faq') {
    const questions = [...(element?.querySelectorAll('h3') ?? [])]
    const index = beat.step % Math.max(1, questions.length)
    const question = questions[index]?.getBoundingClientRect()
    const block = element?.querySelector('.page-faq')?.getBoundingClientRect()
    if (question !== undefined && question.bottom > 100 && question.top < window.innerHeight - 60) {
      const doubt = Math.sin(((performance.now() - since) / 1000) * 2.2)
      return {
        spot: {
          key: `faq:${index}`,
          x:
            (narrow()
              ? window.innerWidth - 44
              : (block?.right ?? question.right) + 70 - doubt * 26) * ratio,
          y: (question.top + question.height / 2) * ratio,
          scale: smallScale(),
        },
        beat,
      }
    }
  }
  if (section === 'cloudflare') return { spot: { ...beside, scale: beside.scale * 1.7 }, beat }
  return { spot: beside, beat }
}

function place(spot: Spot, now: number) {
  if (spot.key !== landed && (flight === null || flight.key !== spot.key)) {
    flight = { from: { ...head }, key: spot.key, start: now }
  }
  if (flight !== null) {
    const progress = Math.min(1, (now - flight.start) / HOP_MS)
    const far = Math.hypot(spot.x - flight.from.x, spot.y - flight.from.y)
    head.x = hop(flight.from.x, spot.x, progress)
    head.y = hop(flight.from.y, spot.y, progress) - arc(progress, Math.min(160 * ratio, far * 0.35))
    head.scale = hop(flight.from.scale, spot.scale, progress)
    head.turn = Math.sin(progress * Math.PI) * 0.4 * Math.sign(spot.x - flight.from.x || 1)
    if (progress >= 1) {
      landed = flight.key
      flight = null
    }
    return
  }
  head.x += (spot.x - head.x) * 0.25
  head.y += (spot.y - head.y) * 0.25
  head.scale += (spot.scale - head.scale) * 0.2
  head.turn *= 0.9
}

function toScreen(point: Point): Point {
  const dx = (point.x - MARK_WIDTH / 2) * head.scale * pulse * (1 + squash * 0.25)
  const dy = (point.y - MARK_HEIGHT / 2) * head.scale * pulse * (1 - squash * 0.35)
  const cos = Math.cos(head.turn)
  const sin = Math.sin(head.turn)
  return { x: head.x + dx * cos - dy * sin, y: head.y - lift + dx * sin + dy * cos }
}

function emit(x: number, y: number, vx: number, vy: number, heat = 0.9) {
  sparks.push({
    homeX: x,
    homeY: y,
    x,
    y,
    vx,
    vy,
    size: 1 + Math.random(),
    heat,
    phase: Math.random(),
  })
  if (sparks.length > 220) sparks.shift()
}

function spit(now: number, target: DOMRect | undefined) {
  if (now - lastEmit < 130) return
  lastEmit = now
  const mouth = toScreen(MOUTH)
  const tx =
    target === undefined
      ? mouth.x - 200 * ratio
      : (target.left + target.width * (0.2 + Math.random() * 0.6)) * ratio
  const ty =
    target === undefined ? mouth.y + 100 * ratio : (target.top + 40 + Math.random() * 80) * ratio
  const frames = 46
  glyphs.push({
    x: mouth.x,
    y: mouth.y,
    vx: (tx - mouth.x) / frames,
    vy: (ty - mouth.y) / frames - 2.2 * ratio,
    life: frames,
    text: GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? '#',
  })
  if (glyphs.length > 60) glyphs.shift()
}

function draw(now: number) {
  const context = surface.value?.getContext('2d')
  if (context === null || context === undefined) return
  const { spot, beat } = direct((now - since) / 1000)
  const scene = spot.key.split(':')[0] ?? ''
  if (scene !== act) {
    act = scene
    since = now
  }
  place(spot, now)
  const ghost = now / 1000
  const small = Math.min(1, Math.max(0.36, head.scale / (1.6 * ratio)))
  const resting = flight === null
  pulse = 1 + 0.025 * Math.sin(ghost * 1.7)
  lift = (Math.sin(ghost * 1.3) * 9 + Math.sin(ghost * 2.9) * 3) * ratio * Math.max(0.5, small)
  if (shape === 'flame') head.turn += Math.sin(ghost * 1.1) * 0.05
  else head.turn *= 0.7
  const next = resting ? beat.shape : 'flame'
  if (next !== shape) {
    previous = shape
    shape = next
    morphStart = now
  }
  const morph = Math.min(1, (now - morphStart) / 520)
  const tint: Tint = beat.tint === null || !resting ? null : TINTS[beat.tint]
  const amount = tint === null ? 0 : 0.8
  const element = sections.find((candidate) => candidate.getAttribute('id') === section)
  const agent = act === 'cta'
  if (resting && beat.glyphs) {
    const into = agent
      ? document.querySelector('[data-landing="cta"] pre')
      : element?.querySelector('figure')
    spit(now, into?.getBoundingClientRect())
  }
  squash *= 0.86
  if (landed === 'admin:press' && pressed !== landed) {
    squash = 1
    for (let count = 0; count < 24; count++) {
      const angle = Math.random() * Math.PI * 2
      emit(head.x, head.y, Math.cos(angle) * 3 * ratio, Math.sin(angle) * 3 * ratio - ratio, 1)
    }
  }
  pressed = landed
  if (resting && beat.sparks && Math.random() < 0.35) {
    emit(
      head.x + (Math.random() - 0.5) * 120 * head.scale,
      head.y - 60 * head.scale,
      (Math.random() - 0.5) * ratio,
      -1.4 * ratio,
      1,
    )
  }
  const pull =
    burst !== null && now < burst.until
      ? { x: burst.x, y: burst.y, radius: 260 * head.scale, strength: 10 * ratio }
      : pointer === null
        ? null
        : {
            x: pointer.x,
            y: pointer.y,
            radius: Math.max(40 * ratio, 110 * head.scale),
            strength: 4 * ratio,
          }

  context.globalCompositeOperation = 'destination-out'
  context.fillStyle = `rgba(0, 0, 0, ${resting ? 0.32 : 0.16})`
  context.fillRect(0, 0, width, height)
  context.globalCompositeOperation = 'lighter'

  const reach = 170 * head.scale
  const aura = context.createRadialGradient(head.x, head.y - lift, 0, head.x, head.y - lift, reach)
  const glow = tint === null ? '240, 169, 59' : `${tint[0]}, ${tint[1]}, ${tint[2]}`
  aura.addColorStop(0, `rgba(${glow}, ${(0.1 * small).toFixed(3)})`)
  aura.addColorStop(1, `rgba(${glow}, 0)`)
  context.fillStyle = aura
  context.fillRect(head.x - reach, head.y - lift - reach, reach * 2, reach * 2)

  const from = shapes[previous]
  const to = shapes[shape]
  const every = small < 0.5 ? 3 : small < 0.7 ? 2 : 1
  const dim = small < 0.7 ? 0.55 + small * 0.4 : 1
  const flame = shape === 'flame' ? morph : previous === 'flame' ? 1 - morph : 0
  const scan = head.y - lift + Math.sin(ghost * 2.4) * MARK_HEIGHT * 0.32 * head.scale
  embers.forEach((ember, index) => {
    const a = from[index] ?? { x: 0, y: 0 }
    const b = to[index] ?? a
    const wave = flicker(a.x, a.y, ember.phase, ghost)
    const home = toScreen({
      x: a.x + (b.x - a.x) * morph + wave.x * flame,
      y: a.y + (b.y - a.y) * morph + wave.y * flame,
    })
    ember.homeX = home.x
    ember.homeY = home.y
    stepEmber(ember, pull, resting ? 0.07 : 0.03, 0.83)
    if (beat.shake && resting) {
      ember.x += (Math.random() - 0.5) * 2.2 * ratio
      ember.y += (Math.random() - 0.5) * 2.2 * ratio
    }
    if (index % every !== 0) return
    const shine = 0.5 + 0.5 * Math.sin(ghost * 3 + ember.phase * 6)
    const size = ember.size * ratio * Math.max(0.55, small) * (0.8 + shine * 0.4)
    if (small > 0.6) {
      context.fillStyle = emberColor(ember.heat, shine, 0.08, tint, amount)
      context.fillRect(ember.x - size * 1.2, ember.y - size * 1.2, size * 2.4, size * 2.4)
    }
    const tone =
      tint !== null && shape === 'cloudflare' && lightCloud[index] === true
        ? TINTS.cloudLight
        : tint
    const scanned = agent && Math.abs(ember.y - scan) < 10 * ratio ? 1 : 0
    context.fillStyle = emberColor(
      Math.min(1, ember.heat * dim + scanned),
      Math.min(1, shine * dim + scanned),
      shape === 'cloudflare' ? dim * 0.75 : dim,
      tone,
      tone === null ? 0 : 1,
    )
    context.fillRect(ember.x - size / 2, ember.y - size / 2, size, size)
  })

  sparks = sparks.filter((spark) => spark.heat > 0)
  for (const spark of sparks) {
    spark.x += spark.vx + Math.sin(ghost * 3 + spark.phase * 9) * 0.3 * ratio
    spark.y += spark.vy
    spark.vy -= 0.015 * ratio
    spark.heat -= 0.012
    context.fillStyle = emberColor(spark.heat, spark.heat, 1, tint, amount)
    const size = spark.size * ratio
    context.fillRect(spark.x, spark.y, size, size)
  }
  if (resting && shape === 'flame' && Math.random() < 0.3) {
    const top = toScreen({ x: 110 + (Math.random() - 0.5) * 40, y: 30 })
    emit(
      top.x,
      top.y,
      (Math.random() - 0.5) * 0.4 * ratio,
      (-0.5 - Math.random() * 0.8) * ratio,
      0.7,
    )
  }

  glyphs = glyphs.filter((glyph) => glyph.life > 0)
  context.font = `${Math.round(13 * ratio)}px "JetBrains Mono Variable", ui-monospace, monospace`
  for (const glyph of glyphs) {
    glyph.x += glyph.vx
    glyph.y += glyph.vy
    glyph.vy += 0.1 * ratio
    glyph.life -= 1
    context.fillStyle = `rgba(246, 193, 99, ${Math.min(1, glyph.life / 18).toFixed(3)})`
    context.fillText(glyph.text, glyph.x, glyph.y)
  }
  if (agent && resting) {
    for (let star = 0; star < 3; star++) {
      const angle = ghost * 1.4 + (star * Math.PI * 2) / 3
      const x = head.x + Math.cos(angle) * 130 * head.scale
      const y = head.y - lift + Math.sin(angle) * 60 * head.scale - 20 * head.scale
      const size = (5 + 2 * Math.sin(ghost * 4 + star)) * ratio
      context.fillStyle = 'rgba(252, 235, 201, 0.95)'
      context.beginPath()
      context.moveTo(x, y - size * 2)
      context.quadraticCurveTo(x, y, x + size * 2, y)
      context.quadraticCurveTo(x, y, x, y + size * 2)
      context.quadraticCurveTo(x, y, x - size * 2, y)
      context.quadraticCurveTo(x, y, x, y - size * 2)
      context.fill()
    }
  }
  if (act === 'faq' && resting) {
    for (let dot = 0; dot < 3; dot++) {
      const on = Math.floor(ghost * 3) % 4 > dot
      const x = head.x + (dot - 1) * 13 * ratio
      const y = head.y - lift - 150 * head.scale
      context.fillStyle = `rgba(246, 193, 99, ${on ? 0.95 : 0.2})`
      context.beginPath()
      context.arc(x, y, 3.2 * ratio, 0, Math.PI * 2)
      context.fill()
    }
    head.turn = Math.sin(ghost * 2.2) * 0.28
  }
  if (landed === 'admin:read') {
    const beam = context.createLinearGradient(head.x, head.y, head.x, head.y + 140 * ratio)
    beam.addColorStop(0, 'rgba(246, 193, 99, 0.22)')
    beam.addColorStop(1, 'rgba(246, 193, 99, 0)')
    context.fillStyle = beam
    context.beginPath()
    context.moveTo(head.x - 8 * ratio, head.y + 20 * ratio)
    context.lineTo(head.x + 8 * ratio, head.y + 20 * ratio)
    context.lineTo(head.x + 70 * ratio, head.y + 140 * ratio)
    context.lineTo(head.x - 70 * ratio, head.y + 140 * ratio)
    context.closePath()
    context.fill()
  }
  context.globalCompositeOperation = 'source-over'
}

function loop(now: number) {
  draw(now)
  frame = requestAnimationFrame(loop)
}

const moved = (event: PointerEvent) =>
  (pointer = { x: event.clientX * ratio, y: event.clientY * ratio })
const left = () => (pointer = null)
function tapped(event: PointerEvent) {
  const x = event.clientX * ratio
  const y = event.clientY * ratio
  if (Math.hypot(x - head.x, y - head.y) < 140 * head.scale) {
    burst = { x, y, until: performance.now() + 220 }
  }
}
const paused = () => {
  cancelAnimationFrame(frame)
  if (!document.hidden) frame = requestAnimationFrame(loop)
}

onMounted(() => {
  if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return
  resize()
  buildShapes()
  embers = embersOf(shapes.flame, seededRandom(11))
  sections = [...document.querySelectorAll('.landing section[id]')]
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) section = entry.target.getAttribute('id') ?? section
      }
    },
    { rootMargin: '-40% 0px -55% 0px' },
  )
  for (const element of sections) observer.observe(element)
  const start = direct(0).spot
  Object.assign(head, { x: start.x, y: start.y, scale: start.scale, turn: 0 })
  landed = start.key
  act = start.key
  since = performance.now()
  for (const [index, ember] of embers.entries()) {
    const home = toScreen(shapes.flame[index] ?? { x: 0, y: 0 })
    Object.assign(ember, { x: home.x, y: home.y })
  }
  window.addEventListener('resize', resize)
  window.addEventListener('pointermove', moved, { passive: true })
  window.addEventListener('pointerdown', tapped, { passive: true })
  document.documentElement.addEventListener('pointerleave', left)
  document.addEventListener('visibilitychange', paused)
  live.value = true
  frame = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  observer?.disconnect()
  light(null)
  live.value = false
  window.removeEventListener('resize', resize)
  window.removeEventListener('pointermove', moved)
  window.removeEventListener('pointerdown', tapped)
  document.documentElement.removeEventListener('pointerleave', left)
  document.removeEventListener('visibilitychange', paused)
})
</script>

<template>
  <canvas
    ref="surface"
    class="pointer-events-none fixed inset-0 z-30 h-dvh w-screen"
    aria-hidden="true"
  />
</template>
