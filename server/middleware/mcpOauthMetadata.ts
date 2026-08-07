/**
 * Serves the two OAuth discovery documents for the remote MCP connector.
 *
 * Middleware rather than server/routes/.well-known/… on purpose: a
 * dot-prefixed directory is not reliably picked up by file-based route
 * scanners, and Claude probes several path variants for the same document
 * (bare, and with the MCP path appended per RFC 9728 §3.1). One matcher covers
 * them all regardless of how the build globs the filesystem.
 *
 * Returns 404 when no OAuth client is configured, so Claude never discovers an
 * authorization server that cannot complete a flow and the API-key path keeps
 * working untouched.
 */
import { anyMcpOauthClient, authorizationServerMetadata, protectedResourceMetadata } from '../utils/mcpOauth'

const PROTECTED_RESOURCE_PATHS = new Set([
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
])

const AUTH_SERVER_PATHS = new Set([
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-authorization-server/mcp',
])

export default defineEventHandler(async (event) => {
  const path = (event.path || '').split('?')[0].replace(/\/+$/, '') || '/'
  // Cheapest possible bail-out — this runs on every request.
  if (!path.startsWith('/.well-known/oauth-')) return

  const isProtectedResource = PROTECTED_RESOURCE_PATHS.has(path)
  const isAuthServer = AUTH_SERVER_PATHS.has(path)
  if (!isProtectedResource && !isAuthServer) return

  setHeader(event, 'access-control-allow-origin', '*')
  setHeader(event, 'access-control-allow-methods', 'GET, OPTIONS')
  setHeader(event, 'access-control-allow-headers', 'content-type, mcp-protocol-version')

  if (event.method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return ''
  }

  if (!(await anyMcpOauthClient())) {
    setResponseStatus(event, 404)
    return {
      error: 'oauth_not_configured',
      message: 'This deployment has no MCP OAuth client. An HQ admin can generate one in FranHRM → Connect Claude, or use an API key: /mcp?api_key=sk_live_…',
    }
  }

  const doc = isProtectedResource
    ? protectedResourceMetadata(event)
    : await authorizationServerMetadata(event)

  setResponseStatus(event, 200)
  setHeader(event, 'cache-control', 'public, max-age=300')
  return doc
})
