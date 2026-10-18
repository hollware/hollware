import { parseFlags } from '../args.ts'
import { UsageError } from '../errors.ts'
import type { Io } from '../io.ts'
import {
  claudeAddLine,
  CLIENT_FILES,
  CLIENTS,
  mcpJson,
  setVariableLine,
  TOKEN_VARIABLE,
  type Client,
} from '../mcp-config.ts'
import { publicUrlOf } from '../public-url.ts'

export const MCP_CONFIG_USAGE = [
  'Usage: hollware mcp-config [--client <claude-code | cursor | vscode | json>] [--url <url>]',
  '                           [--token-file <path>]',
  '',
  'Prints the configuration that connects an MCP client to Hollware, ready to use. The token is',
  `never in it: the client reads it from the environment variable ${TOKEN_VARIABLE}, which a note on`,
  'stderr says how to set from the file that holds the token.',
  'claude-code prints the "claude mcp add" line; cursor, vscode and json print the JSON block of',
  '.cursor/mcp.json, .vscode/mcp.json and .mcp.json (json: any client that reads .mcp.json). Stdout',
  'holds the configuration and nothing else.',
  '',
  'Options:',
  '  --client <client>     claude-code (default), cursor, vscode or json',
  '  --url <url>           The public URL of Hollware (default: HOLLWARE_PUBLIC_URL of wrangler.jsonc)',
  `  --token-file <path>   The file that holds the token, for the note on setting ${TOKEN_VARIABLE}`,
  '  --help                Show this help',
].join('\n')

export function mcpConfig(argv: readonly string[], io: Io): number {
  const { values } = parseFlags({
    args: [...argv],
    allowPositionals: false,
    options: {
      client: { type: 'string' },
      url: { type: 'string' },
      'token-file': { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help === true) {
    io.out(MCP_CONFIG_USAGE)
    return 0
  }
  const client = clientOf(values.client)
  const url = publicUrlOf(io.cwd, values.url)
  if (url === undefined) {
    throw new UsageError(
      '--url is required here: the project has no HOLLWARE_PUBLIC_URL in its wrangler.jsonc to read it from.',
    )
  }
  io.out(client === 'claude-code' ? claudeAddLine(url) : mcpJson(client, url))
  const where = client === 'claude-code' ? '' : ` Save the block as ${CLIENT_FILES[client]}.`
  io.err(
    `Set the token for the client: ${setVariableLine(values['token-file'])} (the block names ${TOKEN_VARIABLE}, never the token).${where}`,
  )
  return 0
}

function clientOf(value: string | undefined): Client {
  const chosen = CLIENTS.find((client) => client === (value ?? 'claude-code'))
  if (chosen === undefined) {
    throw new UsageError(`--client is one of ${CLIENTS.join(', ')}, not "${value ?? ''}".`)
  }
  return chosen
}
