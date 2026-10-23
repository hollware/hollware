import { cpSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vite-plus/test'

import { createProject, setUpProject, type Project } from '../v0.1/support/project.ts'

const CORPUS = join(import.meta.dirname, '..', '..', 'fixtures', 'content', 'blog')

let project: Project
let url = ''
let token = ''

beforeAll(async () => {
  project = createProject()
  token = await setUpProject(project)
  url = await project.start()
})

afterAll(async () => {
  await project.close()
})

it('publishes a corpus that links in a cycle, in one step', async () => {
  const directory = join(project.scratch, 'content')
  mkdirSync(directory)
  cpSync(CORPUS, join(directory, 'blog'), { recursive: true })
  const tokenFile = project.writeSecret('token', `${token}\n`)

  const run = await project.hollware(
    'import',
    directory,
    '--url',
    url,
    '--token-file',
    tokenFile,
    '--publish',
  )

  expect(run.code).toBe(0)
  expect(run.output.trimEnd().split('\n').at(-1)).toBe(
    'Publishing: 10 published, 0 need acknowledgement, 0 blocked.',
  )
  const [rows] = await project.query("SELECT count(*) AS n FROM entries WHERE status = 'published'")
  expect(rows).toEqual([{ n: 10 }])
})
