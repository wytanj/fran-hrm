// Stateless JSON-RPC dispatcher for the remote /mcp endpoint. Hand-rolled
// (not the SDK's StreamableHTTPServerTransport) so each POST is independent —
// no session affinity needed on serverless.
import { getCloudMcpInstructions } from './agentInstructions.mjs'
import { getMcpScopes } from './context.mjs'
import { isToolPermitted } from './toolScopes.mjs'
import { handleTool, toolDefinitions } from './tools.mjs'

const PROTOCOL_VERSION = '2025-06-18'
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18'])

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

async function handleSingle(msg, opts = {}) {
  if (!msg || typeof msg !== 'object') return rpcError(null, -32600, 'Invalid request')
  const { id, method, params } = msg

  // Notifications: no id, fire-and-forget.
  if (id === undefined && typeof method === 'string' && method.startsWith('notifications/')) return null

  try {
    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion
        return rpcResult(id, {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'fran-hrm', version: '0.1.0' },
          instructions: getCloudMcpInstructions(),
        })
      }
      case 'ping':
        return rpcResult(id, {})
      case 'resources/list':
        return rpcResult(id, { resources: [] })
      case 'prompts/list':
        return rpcResult(id, { prompts: [] })
      case 'tools/list': {
        const scopes = getMcpScopes()
        const tools = toolDefinitions.filter((t) => isToolPermitted(t.name, { scopes }))
        // Throw rather than return [] — an empty list surfaces in clients as
        // an unexplained "no tools available".
        if (!tools.length) {
          throw new Error('No MCP tools permitted for this API key. Ask a FranHRM admin for a key with the mcp:safe or mcp:full scope package.')
        }
        return rpcResult(id, { tools })
      }
      case 'tools/call': {
        const name = params?.name
        const scopes = getMcpScopes()
        if (!isToolPermitted(name, { scopes })) {
          throw new Error(`MCP scope denied: tool "${name}" is not permitted for this connection. Call capabilities to see what you may do.`)
        }
        return rpcResult(id, await handleTool(name, params?.arguments || {}))
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`)
    }
  } catch (err) {
    const message = err?.message || String(err)
    const code = /scope denied|API key|not permitted/i.test(message) ? -32001 : -32000
    return rpcError(id, code, message)
  }
}

/** @param {unknown} body parsed JSON-RPC message or batch */
export async function handleMcpJsonRpc(body, opts = {}) {
  if (Array.isArray(body)) {
    const results = await Promise.all(body.map((m) => handleSingle(m, opts)))
    const filtered = results.filter((r) => r !== null)
    return filtered.length ? filtered : null
  }
  return handleSingle(body, opts)
}
