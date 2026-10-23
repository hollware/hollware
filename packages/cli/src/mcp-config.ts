export const CLIENTS = ['claude-code', 'cursor', 'vscode', 'json'] as const
export type Client = (typeof CLIENTS)[number]

export const TOKEN_VARIABLE = 'HOLLWARE_TOKEN'

export function mcpUrlOf(url: string | undefined): string {
  return `${url ?? '<your Hollware URL>'}/mcp`
}

export function claudeAddLine(url: string | undefined): string {
  return `claude mcp add --transport http hollware ${mcpUrlOf(url)} --header 'Authorization: Bearer \${${TOKEN_VARIABLE}}'`
}

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

export const CLIENT_FILES: Readonly<Record<Exclude<Client, 'claude-code'>, string>> = {
  cursor: '.cursor/mcp.json',
  vscode: '.vscode/mcp.json',
  json: '.mcp.json',
}

export function setVariableLine(tokenFile: string | undefined): string {
  return `export ${TOKEN_VARIABLE}="$(cat ${tokenFile ?? '<token-file>'})"`
}
