import { describe, expect, it } from 'vite-plus/test'
import { checkDevPort } from '../guards/dev-port.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readText } from '../support/repo.ts'

// Fails when: the playground or the starter stops serving `vp dev` on a fixed port with
// strictPort, or its HOLLWARE_PUBLIC_URL names another port than vite.config.ts.

const PROJECTS = ['apps/playground', 'templates/starter']

const read = (path: string) => file(path, readText(path))

describe('dev port', () => {
  it.each(PROJECTS)('%s serves on the port of its public URL', (project) => {
    const violations = checkDevPort({
      viteConfig: read(`${project}/vite.config.ts`),
      wranglerConfig: read(`${project}/wrangler.jsonc`),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const vite = (text: string) => file('p/vite.config.ts', text)
    const wrangler = (url: string) =>
      file('p/wrangler.jsonc', `{ "vars": { "HOLLWARE_PUBLIC_URL": "${url}" } }`)

    it('reports a port that may move', () => {
      expect(
        checkDevPort({
          viteConfig: vite('server: { port: 5199 }'),
          wranglerConfig: wrangler('http://localhost:5199'),
        }).map((violation) => violation.rule),
      ).toEqual(['dev-port/fixed'])
    })

    it('reports a public URL on another port', () => {
      expect(
        checkDevPort({
          viteConfig: vite('server: { port: 5199, strictPort: true }'),
          wranglerConfig: wrangler('http://localhost:5173'),
        }).map((violation) => violation.rule),
      ).toEqual(['dev-port/public-url'])
    })
  })
})
