// Create a new workspace from an SSO identity. Allowlist-gated (only specific
// emails/domains may create; everyone else joins by invite). Idempotent, and
// mints the fran_hrm_session for the new hq_admin on success.
import { getSsoUser, issueStaffSession } from '../../utils/sessionAuth'
import { recordAudit } from '../../../core/audit/record.mjs'
// @ts-ignore .mjs shared module
import { createWorkspace, isCreateAllowed } from '../../../core/workspace/onboarding.mjs'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const user = await getSsoUser(String(body?.access_token || ''))
  if (!user) throw apiError(401, 'Could not verify your Google sign-in. Try again.')
  if (!isCreateAllowed(user.email)) {
    throw apiError(403, 'This account is not allowed to create a workspace. Ask an owner to invite you instead.')
  }

  const db = getAdminClient()
  const orgName = String(body?.org_name || '').trim() || `${user.name}'s workspace`
  const { staff, workspace, created } = await createWorkspace(db, {
    authUserId: user.id, email: user.email, name: user.name, orgName,
  })

  await issueStaffSession(event, staff)
  if (created) {
    await recordAudit(db, {
      workspace_id: staff.workspace_id,
      actor_kind: 'user', actor_id: staff.id, actor_name: staff.display_name, source_type: 'web',
      object_type: 'workspaces', entity_id: staff.workspace_id, operation: 'INSERT',
      metadata: { action: 'create_workspace', name: orgName, by_email: user.email },
    })
  }
  return { status: 'entered', created, workspace: workspace ? { id: workspace.id, name: workspace.name } : null }
})
