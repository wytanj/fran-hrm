// Path-embedded key form for connectors that can't set headers:
// https://<host>/mcp/c/sk_live_…
export default defineEventHandler((event) => {
  const token = getRouterParam(event, 'token') || ''
  return mcpHttpHandler(event, decodeURIComponent(token))
})
