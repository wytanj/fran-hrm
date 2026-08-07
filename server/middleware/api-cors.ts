// CORS for headless surfaces (/api/v1/*, /fran/*, /mcp*): wildcard origin,
// 204 preflights. The web app itself is same-origin and unaffected.
export default defineEventHandler((event) => {
  const path = event.path || ''
  if (!path.startsWith('/api/v1/') && !path.startsWith('/fran/') && !path.startsWith('/mcp')) return
  setHeader(event, 'Access-Control-Allow-Origin', '*')
  setHeader(event, 'Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  setHeader(event, 'Access-Control-Allow-Headers', 'Authorization, Content-Type, X-API-Key, Mcp-Session-Id, Mcp-Protocol-Version')
  setHeader(event, 'Access-Control-Expose-Headers', 'Mcp-Session-Id')
  if (event.method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return ''
  }
})
