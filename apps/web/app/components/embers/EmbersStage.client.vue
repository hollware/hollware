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

const COUNT = 2200
const HOP_MS = 820
const MOUTH = { x: 102, y: 200 }

const live = useState('embers-live', () => false)
const surface = ref<HTMLCanvasElement | null>(null)

let marks: Point[] = []
let embers: Ember[] = []
let sparks: Ember[] = []
let frame = 0
let ratio = 1
let width = 0
let height = 0
let pointer: { x: number; y: number } | null = null
let burst: { x: number; y: number; until: number } | null = null
let section = 'hero'
let sections: Element[] = []
let observer: IntersectionObserver | null = null
let moodSince = 0
let lastSpark = 0
let flight: { from: Head; key: string; start: number } | null = null
let landed = ''
let swirled = ''
const head: Head = { x: 0, y: 0, scale: 0, turn: 0 }
let pulse = 1
let lift = 0

function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function sampleMark(): Point[] {
  const zoom = 4
  const shape = document.createElement('canvas')
  shape.width = MARK_WIDTH * zoom
  shape.height = MARK_HEIGHT * zoom
  const context = shape.getContext('2d')
  if (context === null) return []
  context.scale(zoom, zoom)
  context.fill(new Path2D(MARK_PATH), 'evenodd')
  const pixels = context.getImageData(0, 0, shape.width, shape.height).data
  let filled = 0
  for (let index = 3; index < pixels.length; index += 4) if ((pixels[index] ?? 0) > 128) filled++
  const step = Math.max(1, Math.sqrt(filled / COUNT))
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

function resize() {
  if (surface.value === null) return
  ratio = window.devicePixelRatio || 1
  width = Math.round(window.innerWidth * ratio)
  height = Math.round(window.innerHeight * ratio)
  surface.value.width = width
  surface.value.height = height
}

function slotSpot(name: 'hero' | 'cta'): Spot | null {
  const slot = document.querySelector(`[data-ember-slot="${name}"]`)
  const box = slot?.getBoundingClientRect()
  if (box === undefined || box.height === 0) return null
  const inView = box.bottom > window.innerHeight * 0.3 && box.top < window.innerHeight * 0.8
  if (!inView) return null
  return {
    key: name,
    x: (box.left + box.width / 2) * ratio,
    y: (box.top + box.height / 2) * ratio,
    scale: ((box.height * 0.8) / MARK_HEIGHT) * ratio,
  }
}

function sectionSpot(): Spot {
  const element = sections.find((candidate) => candidate.getAttribute('id') === section)
  const narrow = window.innerWidth < 768
  const size = (narrow ? 56 : 92) / MARK_HEIGHT
  const title = element?.querySelector(narrow ? '.page-chapter' : 'h2')?.getBoundingClientRect()
  const box = element?.getBoundingClientRect()
  const right = Math.min(
    window.innerWidth - (narrow ? 44 : 120),
    (box?.right ?? window.innerWidth) - 120,
  )
  const y = title === undefined ? window.innerHeight / 2 : title.top + title.height / 2
  return {
    key: section,
    x: (narrow ? window.innerWidth - 44 : right) * ratio,
    y: Math.min(window.innerHeight - 60, Math.max(90, y)) * ratio,
    scale: size * ratio,
  }
}

function spotNow(): Spot {
  return slotSpot('hero') ?? slotSpot('cta') ?? sectionSpot()
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
  if (sparks.length > 160) sparks.shift()
}

function place(spot: Spot, now: number) {
  if (spot.key !== landed && (flight === null || flight.key !== spot.key)) {
    flight = { from: { ...head }, key: spot.key, start: now }
    moodSince = now
  }
  if (flight !== null) {
    const progress = Math.min(1, (now - flight.start) / HOP_MS)
    head.x = hop(flight.from.x, spot.x, progress)
    head.y = hop(flight.from.y, spot.y, progress) - arc(progress, 140 * ratio)
    head.scale = hop(flight.from.scale, spot.scale, progress)
    head.turn = flight.from.turn * (1 - progress) + Math.sin(progress * Math.PI) * 0.35
    if (progress >= 1) {
      landed = flight.key
      flight = null
    }
    return
  }
  head.x += (spot.x - head.x) * 0.3
  head.y += (spot.y - head.y) * 0.3
  head.scale += (spot.scale - head.scale) * 0.2
  head.turn *= 0.9
}

function react(mood: Mood, now: number) {
  const since = (now - moodSince) / 1000
  const mouth = toScreen(MOUTH.x, MOUTH.y)
  let tint: Tint = null
  let amount = 0
  let jitter = 0
  pulse = 1
  lift = 0
  if (mood === 'typing' && now - lastSpark > 110) {
    lastSpark = now
    emit(mouth.x, mouth.y, (2 + Math.random() * 2.5) * ratio, (-0.6 - Math.random()) * ratio)
  }
  if (mood === 'calm') pulse = 1 + 0.04 * Math.sin(since * 2.2)
  if (mood === 'calm' && swirled !== landed && flight === null) {
    swirled = landed
    for (const ember of embers) {
      const dx = ember.x - head.x
      const dy = ember.y - head.y
      ember.vx += -dy * 0.06
      ember.vy += dx * 0.06
    }
  }
  if (mood === 'alarm') {
    const phase = since % 3
    if (phase < 1.1) {
      tint = TINTS.alarm
      amount = 0.85
      jitter = 1.6 * ratio
    } else {
      pulse = 1 + 0.14 * Math.max(0, 1 - (phase - 1.1) * 3)
    }
  }
  if (mood === 'nod' && since % 2.4 < 0.8) {
    lift = Math.abs(Math.sin((since % 2.4) * Math.PI * 2.5)) * 12 * ratio
  }
  if (mood === 'cloud') {
    tint = TINTS.cloud
    amount = 0.7
    if (now - lastSpark > 160) {
      lastSpark = now
      emit(
        head.x + (Math.random() - 0.5) * 60 * head.scale,
        head.y - 80 * head.scale,
        (Math.random() - 0.5) * ratio,
        -1.5 * ratio,
        1,
      )
    }
  }
  if (mood === 'curious') head.turn = 0.22 * Math.sin(since * 1.6)
  if (mood === 'away') pulse = 1 + 0.02 * Math.sin(since * 1.8)
  return { tint, amount, jitter }
}

function toScreen(px: number, py: number): Point {
  const dx = (px - MARK_WIDTH / 2) * head.scale * pulse
  const dy = (py - MARK_HEIGHT / 2) * head.scale * pulse
  const cos = Math.cos(head.turn)
  const sin = Math.sin(head.turn)
  return { x: head.x + dx * cos - dy * sin, y: head.y - lift + dx * sin + dy * cos }
}

function draw(now: number) {
  const context = surface.value?.getContext('2d')
  if (context === null || context === undefined) return
  const spot = spotNow()
  place(spot, now)
  const mood =
    flight === null
      ? spot.key === 'hero' || spot.key === 'cta'
        ? 'away'
        : moodOf(spot.key)
      : 'away'
  const { tint, amount, jitter } = react(mood, now)
  const small = Math.min(1, Math.max(0.42, head.scale / (1.6 * ratio)))
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
  context.clearRect(0, 0, width, height)
  context.globalCompositeOperation = 'lighter'
  const time = now / 1000
  embers.forEach((ember, index) => {
    const home = toScreen(marks[index]?.x ?? 0, marks[index]?.y ?? 0)
    ember.homeX = home.x
    ember.homeY = home.y
    stepEmber(ember, pull, flight === null ? 0.06 : 0.035, 0.84)
    if (jitter > 0) {
      ember.x += (Math.random() - 0.5) * jitter
      ember.y += (Math.random() - 0.5) * jitter
    }
    const glow = 0.5 + 0.5 * Math.sin(time * 3 + ember.phase * 6)
    const size = ember.size * ratio * small * (0.8 + glow * 0.4)
    if (small > 0.6) {
      context.fillStyle = emberColor(ember.heat, glow, 0.1, tint, amount)
      context.fillRect(ember.x - size * 1.2, ember.y - size * 1.2, size * 2.4, size * 2.4)
    }
    context.fillStyle = emberColor(ember.heat, glow, 1, tint, amount)
    context.fillRect(ember.x - size / 2, ember.y - size / 2, size, size)
  })
  sparks = sparks.filter((spark) => spark.heat > 0)
  for (const spark of sparks) {
    spark.x += spark.vx
    spark.y += spark.vy
    spark.vy -= 0.02 * ratio
    spark.heat -= 0.012
    context.fillStyle = emberColor(spark.heat, spark.heat, 1, tint, amount)
    const size = spark.size * ratio
    context.fillRect(spark.x, spark.y, size, size)
  }
  if (flight === null && mood === 'away' && Math.random() < 0.25) {
    emit(
      head.x + (Math.random() - 0.5) * 80 * head.scale,
      head.y - 70 * head.scale,
      (Math.random() - 0.5) * 0.4 * ratio,
      (-0.4 - Math.random() * 0.8) * ratio,
      0.7,
    )
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
  if (Math.hypot(x - head.x, y - head.y) < 140 * head.scale)
    burst = { x, y, until: performance.now() + 220 }
}
const paused = () => {
  cancelAnimationFrame(frame)
  if (!document.hidden) frame = requestAnimationFrame(loop)
}

onMounted(() => {
  if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return
  resize()
  marks = sampleMark()
  embers = embersOf(marks, seededRandom(11))
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
  const start = spotNow()
  Object.assign(head, { x: start.x, y: start.y, scale: start.scale, turn: 0 })
  landed = start.key
  for (const [index, ember] of embers.entries()) {
    const home = toScreen(marks[index]?.x ?? 0, marks[index]?.y ?? 0)
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
