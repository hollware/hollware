// Fails when:
// - "prints the claude mcp add line": the line stops naming the URL of /mcp, or names the
//   token and not ${HOLLWARE_TOKEN}, or the default client stops being claude-code.
// - "prints the JSON block of each client": a client's block changes its keys, or its way to
//   name the variable (${HOLLWARE_TOKEN}, ${env:HOLLWARE_TOKEN}), or puts anything but the JSON
//   on stdout, or the token of the file is read into it.
// - "says how to set the variable": the note on stderr stops naming the token file, or the file
//   it is saved in.
// - "needs a URL": a project with no public URL and no --url prints a URL that is no URL.
import { describe, expect, it } from 'vite-plus/test'

import { run } from './support/io.ts'
import { tempDirs, WRANGLER_JSONC } from './support/project.ts'

const temp = tempDirs()

const cwd = () =>
  temp.make({
    'wrangler.jsonc': WRANGLER_JSONC.replace(
      '{',
      '{ "vars": { "HOLLWARE_PUBLIC_URL": "https://cms.example.com" },',
    ),
  })

describe('hollware mcp-config', () => {
  it('prints the claude mcp add line, which names the variable, by default', async () => {
    const { code, out, err } = await run(['mcp-config'], { cwd: cwd() })

    expect(code).toBe(0)
    expect(out).toEqual([
      "claude mcp add --transport http hollware https://cms.example.com/mcp --header 'Authorization: Bearer ${HOLLWARE_TOKEN}'",
    ])
    expect(err).toEqual([
      'Set the token for the client: export HOLLWARE_TOKEN="$(cat <token-file>)" (the block names HOLLWARE_TOKEN, never the token).',
    ])
  })

  it.each([
    [
      'json',
      {
        mcpServers: {
          hollware: {
            type: 'http',
            url: 'https://cms.example.com/mcp',
            headers: { Authorization: 'Bearer ${HOLLWARE_TOKEN}' },
          },
        },
      },
      '.mcp.json',
    ],
    [
      'cursor',
      {
        mcpServers: {
          hollware: {
            url: 'https://cms.example.com/mcp',
            headers: { Authorization: 'Bearer ${env:HOLLWARE_TOKEN}' },
          },
        },
      },
      '.cursor/mcp.json',
    ],
    [
      'vscode',
      {
        servers: {
          hollware: {
            type: 'http',
            url: 'https://cms.example.com/mcp',
            headers: { Authorization: 'Bearer ${env:HOLLWARE_TOKEN}' },
          },
        },
      },
      '.vscode/mcp.json',
    ],
  ])('prints the JSON block of %s, and only that on stdout', async (client, block, file) => {
    const { code, out, err } = await run(
      ['mcp-config', '--client', client, '--token-file', '/secure/hollware.token'],
      { cwd: cwd() },
    )

    expect(code).toBe(0)
    expect(out).toHaveLength(1)
    expect(JSON.parse(out[0] ?? '')).toEqual(block)
    expect(err).toEqual([
      `Set the token for the client: export HOLLWARE_TOKEN="$(cat /secure/hollware.token)" (the block names HOLLWARE_TOKEN, never the token). Save the block as ${file}.`,
    ])
  })

  it('takes --url over the project, and needs one from somewhere', async () => {
    const given = await run(['mcp-config', '--url', 'https://other.example.com/x'], { cwd: cwd() })
    const none = await run(['mcp-config'], { cwd: temp.make({ 'wrangler.jsonc': WRANGLER_JSONC }) })
    const bad = await run(['mcp-config', '--client', 'emacs'], { cwd: cwd() })

    expect(given.out).toEqual([
      "claude mcp add --transport http hollware https://other.example.com/mcp --header 'Authorization: Bearer ${HOLLWARE_TOKEN}'",
    ])
    expect(none.err).toEqual([
      'hollware mcp-config: --url is required here: the project has no HOLLWARE_PUBLIC_URL in its wrangler.jsonc to read it from. Run "hollware mcp-config --help" for the options.',
    ])
    expect(bad.err).toEqual([
      'hollware mcp-config: --client is one of claude-code, cursor, vscode, json, not "emacs". Run "hollware mcp-config --help" for the options.',
    ])
  })
})
