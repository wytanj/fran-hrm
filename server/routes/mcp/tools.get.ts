// Human/agent-browsable tool listing (auth optional: unauthenticated callers
// see the full catalog with scope requirements; authenticated callers see
// what their key can actually do).
// @ts-ignore .mjs shared module
import { toolDefinitions } from '../../../mcp/src/tools.mjs'
// @ts-ignore .mjs shared module
import { TOOL_SCOPE_CATALOG, isToolPermitted } from '../../../mcp/src/toolScopes.mjs'
import { authenticateApiKey } from '../../utils/apiAuth'

export default defineEventHandler(async (event) => {
  const key = await authenticateApiKey(event)
  const scopes = key ? key.scopes : null
  return {
    authenticated: !!key,
    tools: toolDefinitions.map((t: any) => ({
      name: t.name,
      description: t.description,
      scope: TOOL_SCOPE_CATALOG[t.name]?.scope ?? null,
      privileged: !!TOOL_SCOPE_CATALOG[t.name]?.privileged,
      permitted: key ? isToolPermitted(t.name, { scopes }) : undefined,
    })),
  }
})
