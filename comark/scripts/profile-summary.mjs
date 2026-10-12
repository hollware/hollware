// Self time per function in a .cpuprofile (Chrome format), top N.
import { readFileSync } from 'node:fs'
const profile = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map()
profile.samples.forEach((id, i) => {
  const delta = (profile.timeDeltas[i] ?? 0) / 1000
  self.set(id, (self.get(id) ?? 0) + delta)
})
const rows = [...self.entries()]
  .map(([id, ms]) => {
    const f = byId.get(id).callFrame
    return {
      ms,
      name: f.functionName || '(anonymous)',
      where: `${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`,
    }
  })
  .sort((a, b) => b.ms - a.ms)
console.log(
  `samples: ${profile.samples.length}, total ${rows.reduce((s, r) => s + r.ms, 0).toFixed(1)} ms`,
)
for (const r of rows.slice(0, Number(process.argv[3] ?? 12)))
  console.log(`${r.ms.toFixed(1).padStart(6)} ms  ${r.name.padEnd(28)} ${r.where}`)
