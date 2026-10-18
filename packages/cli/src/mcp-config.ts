/**
 * The configuration that connects an MCP client to Hollware. The token itself is never in it:
 * the client reads it from the environment variable HOLLWARE_TOKEN.
 */

export const CLIENTS = ['claude-code', 'cursor', 'vscode', 'json'] as const
export type Client = (typeof CLIENTS)[number]

/** The environment variable that holds the token. */
export const TOKEN_VARIABLE = 'HOLLWARE_TOKEN'

/** The URL of the MCP endpoint of a Hollware, or the placeholder when the URL is not known. */
export function mcpUrlOf(url: string | undefined): string {
  return `${url ?? '<your Hollware URL>'}/mcp`
}

/** The `claude mcp add` line. Single quotes: Claude Code expands ${HOLLWARE_TOKEN} itself, at each start. */
export function claudeAddLine(url: string | undefined): string {
  return `claude mcp add --transport http hollware ${mcpUrlOf(url)} --header 'Authorization: Bearer \${${TOKEN_VARIABLE}}'`
}

/**
 * The block of `.mcp.json` (Claude Code and the generic `json`), `.cursor/mcp.json` (Cursor) or
 * `.vscode/mcp.json` (VS Code), as JSON. Each client names an environment variable its own way.
 */
export function mcpJson(client: Client, url: string | undefined): string {
  const server = (variable: string, type: boolean) => ({
    ...(type ? { type: 'http' } : {}),
    url: mcpUrlOf(url),
    headers: { Authorization: `Bearer ${variable}` },
  })
  const block =
    client === 'vscode'
      ? { servers: { hollware: server(`\${env:${TOKEN_VARIABLE}}`, true) } }
      : client === 'cursor'
        ? { mcpServers: { hollware: server(`\${env:${TOKEN_VARIABLE}}`, false) } }
        : { mcpServers: { hollware: server(`\${${TOKEN_VARIABLE}}`, true) } }
  return JSON.stringify(block, null, 2)
}

/** The file each client reads its block from. */
export const CLIENT_FILES: Readonly<Record<Exclude<Client, 'claude-code'>, string>> = {
  cursor: '.cursor/mcp.json',
  vscode: '.vscode/mcp.json',
  json: '.mcp.json',
}

/** How to set the variable from the file that holds the token. */
export function setVariableLine(tokenFile: string | undefined): string {
  return `export ${TOKEN_VARIABLE}="$(cat ${tokenFile ?? '<token-file>'})"`
}
