// Summarizes a .cpuprofile: inclusive time of the call stacks that matter, by function name.
import { readFileSync } from 'node:fs'

const profile = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const byId = new Map(profile.nodes.map((node) => [node.id, node]))
const parent = new Map()
for (const node of profile.nodes)
  for (const child of node.children ?? []) parent.set(child, node.id)

const self = new Map()
profile.samples.forEach((id, index) => {
  self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0))
})
const inclusive = new Map()
for (const [id, time] of self) {
  const seen = new Set()
  for (let cursor = id; cursor !== undefined; cursor = parent.get(cursor)) {
    const frame = byId.get(cursor).callFrame
    const key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').slice(-2).join('/')}:${frame.lineNumber + 1}`
    if (seen.has(key)) continue
    seen.add(key)
    inclusive.set(key, (inclusive.get(key) ?? 0) + time)
  }
}
const total = [...self.values()].reduce((a, b) => a + b, 0)
console.log(`total sampled: ${(total / 1000).toFixed(1)} ms over ${profile.samples.length} samples`)
for (const [key, time] of [...inclusive.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`${(time / 1000).toFixed(1).padStart(6)} ms  ${key}`)
}
