#!/usr/bin/env node
/**
 * FranHRM MCP server (stdio).
 * Env: SUPABASE_URL, SUPABASE_SECRET_KEY, FRAN_HRM_MCP_WORKSPACE_ID,
 *      FRAN_HRM_MCP_PROFILE (safe|full|unrestricted), FRAN_HRM_MCP_SCOPES,
 *      FRAN_HRM_MCP_CLIENT
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { describeMcpScopes, getMcpClientName, getWorkspaceId, loadDotEnv } from './context.mjs'
import { getStdioMcpInstructions } from './agentInstructions.mjs'
import { isToolPermitted } from './toolScopes.mjs'
import { handleTool, toolDefinitions } from './tools.mjs'

loadDotEnv()

const server = new Server(
  { name: 'fran-hrm', version: '0.1.0' },
  { capabilities: { tools: {} }, instructions: getStdioMcpInstructions() },
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const { scopes } = describeMcpScopes()
  return { tools: toolDefinitions.filter((t) => isToolPermitted(t.name, { scopes })) }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return handleTool(request.params.name, request.params.arguments || {})
})

async function main() {
  // Diagnostics go to stderr — stdout is the MCP protocol channel.
  const ws = getWorkspaceId()
  if (!ws) console.error('[fran-hrm-mcp] WARN: FRAN_HRM_MCP_WORKSPACE_ID not set — tools will fail until configured (the seed script prints it)')
  else console.error(`[fran-hrm-mcp] workspace=${ws}`)
  const scopeInfo = describeMcpScopes()
  console.error(scopeInfo.scopes == null
    ? `[fran-hrm-mcp] scopes=UNRESTRICTED (profile=${scopeInfo.profile})`
    : `[fran-hrm-mcp] scopes=${scopeInfo.profile}: ${scopeInfo.scopes.join(',')}`)
  console.error(`[fran-hrm-mcp] client=${getMcpClientName()} tools=${toolDefinitions.length}`)

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[fran-hrm-mcp] ready (stdio)')
}

main().catch((err) => {
  console.error('[fran-hrm-mcp] fatal', err)
  process.exit(1)
})
