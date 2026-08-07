// Shared Streamable-HTTP handler for /mcp and /mcp/c/:token.
// Hard-won behaviours copied from fran-skums:
// - GET with an SSE Accept → 405 (we don't offer server→client streaming;
//   returning discovery JSON there makes clients report "couldn't reach").
// - Plain GET → unauthenticated discovery JSON with connection instructions.
// - initialize/ping/notifications are public; everything else needs auth.
// - Auth failures return HTTP 200 with a JSON-RPC -32001 error, because MCP
//   clients treat 401 as "couldn't reach" and hide the actionable message.
import { randomUUID } from 'node:crypto'
import { authenticateRemoteMcp, runRemoteMcpJsonRpc, handleMcpJsonRpc } from './remoteMcp'
import { anyMcpOauthClient, mcpOauthIssuer, mcpUnauthorizedHeader } from './mcpOauth'

function needsAuth(body: any): boolean {
  const check = (msg: any) => {
    const method = msg?.method
    if (!method) return false
    if (method === 'initialize' || method === 'ping') return false
    if (String(method).startsWith('notifications/')) return false
    if (method === 'resources/list' || method === 'prompts/list') return false
    return true
  }
  return Array.isArray(body) ? body.some(check) : check(body)
}

export async function mcpHttpHandler(event: any, pathToken?: string) {
  if (pathToken) event.context.mcpApiKey = pathToken

  setHeader(event, 'Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate')
  const method = event.method

  if (method === 'OPTIONS' || method === 'DELETE') {
    setResponseStatus(event, 204)
    return ''
  }

  if (method === 'GET') {
    const accept = getHeader(event, 'accept') || ''
    if (accept.includes('text/event-stream')) {
      setResponseStatus(event, 405)
      setHeader(event, 'Allow', 'POST, OPTIONS, DELETE')
      return { error: 'SSE streaming is not offered; POST JSON-RPC messages to this endpoint.' }
    }
    const issuer = mcpOauthIssuer(event)
    const oauthClient = await anyMcpOauthClient()
    return {
      name: 'fran-hrm',
      description: 'FranHRM MCP server — staff directory, rosters, time & attendance, leave. e.g. ask for hours worked by a staff member in any timeframe.',
      protocol: 'MCP Streamable HTTP (POST JSON-RPC)',
      endpoint: '/mcp',
      auth: oauthClient
        ? 'OAuth 2.1 (recommended): add this URL as a Claude connector and click Connect — you sign in to FranHRM with your employee code + PIN, and Claude gets tools scoped to your own role. API keys also work: Authorization: Bearer sk_live_…'
        : 'API key: Authorization: Bearer sk_live_…, ?api_key=…, or /mcp/c/<key>. Keys come from a FranHRM admin.',
      oauth: oauthClient
        ? {
            authorization_endpoint: `${issuer}/oauth/authorize`,
            token_endpoint: `${issuer}/oauth/token`,
            protected_resource_metadata: `${issuer}/.well-known/oauth-protected-resource/mcp`,
            client_id_required: true,
          }
        : null,
      tools_hint: 'capabilities, staff_search, hours_worked, attendance_summary, roster_get, leave_balance_get, …',
    }
  }

  if (method !== 'POST') {
    setResponseStatus(event, 405)
    setHeader(event, 'Allow', 'POST, GET, OPTIONS, DELETE')
    return { error: 'Method not allowed' }
  }

  const body = await readBody(event)
  setHeader(event, 'Mcp-Session-Id', getHeader(event, 'mcp-session-id') || randomUUID())

  // Notification-only bodies get 202 with no content.
  const onlyNotifications = Array.isArray(body)
    ? body.every((m: any) => m?.id === undefined && String(m?.method || '').startsWith('notifications/'))
    : body?.id === undefined && String(body?.method || '').startsWith('notifications/')
  if (onlyNotifications) {
    setResponseStatus(event, 202)
    return ''
  }

  let response: any
  if (needsAuth(body)) {
    try {
      const auth = await authenticateRemoteMcp(event)
      response = await runRemoteMcpJsonRpc(auth, body)
    } catch (err: any) {
      const id = Array.isArray(body) ? body[0]?.id ?? null : body?.id ?? null
      // Deliberate fork. With NO credential presented and OAuth configured, a
      // real 401 + WWW-Authenticate is what bootstraps Claude's Connect flow —
      // Anthropic will not read that header off a 200. But when a credential
      // WAS presented and is merely revoked/expired/underpowered, return 200
      // with a JSON-RPC error: MCP clients treat 401 as "couldn't reach" and
      // would hide the actionable message behind a pointless OAuth dance.
      const presented = Boolean(
        event.context.mcpApiKey || getHeader(event, 'authorization') || getQuery(event).api_key,
      )
      if (!presented && (await anyMcpOauthClient())) {
        setResponseStatus(event, 401)
        setHeader(event, 'WWW-Authenticate', mcpUnauthorizedHeader(event))
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32001, message: 'Authentication required. Connect this FranHRM connector in Claude to sign in.' },
        }
      }
      response = {
        jsonrpc: '2.0',
        id,
        // message carries the full explanation; statusMessage is now only the
        // short HTTP reason phrase.
        error: { code: -32001, message: err?.message || err?.statusMessage || 'Authentication failed' },
      }
    }
  } else {
    response = await handleMcpJsonRpc(body, { cloud: true })
  }

  if (response === null) {
    setResponseStatus(event, 202)
    return ''
  }

  // SSE-only Accept: wrap the JSON response as a single SSE message.
  const accept = getHeader(event, 'accept') || ''
  if (accept.includes('text/event-stream') && !accept.includes('application/json')) {
    setHeader(event, 'Content-Type', 'text/event-stream')
    return `event: message\ndata: ${JSON.stringify(response)}\n\n`
  }
  return response
}
