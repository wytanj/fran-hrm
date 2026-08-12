// SSO bridge: take a verified Google token, decide what to do with the person,
// and — when they belong somewhere — mint the normal fran_hrm_session so the
// rest of the app works unchanged. Public route (they have no session yet).
import { getSsoUser, issueStaffSession } from '../../utils/sessionAuth'
// @ts-ignore .mjs shared module
import { resolveMember, linkAuthUser, findPendingInvite, acceptInvite, isCreateAllowed } from '../../../core/workspace/onboarding.mjs'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const user = await getSsoUser(String(body?.access_token || ''))
  if (!user) throw apiError(401, 'Could not verify your Google sign-in. Try again.')
  const db = getAdminClient()

  // Already a member (by Google link or by email — link it if it was PIN-only).
  const member = await resolveMember(db, { authUserId: user.id, email: user.email })
  if (member) {
    if (member.auth_user_id !== user.id) await linkAuthUser(db, member.id, user.id)
    await issueStaffSession(event, member)
    return { status: 'entered' }
  }

  // Invited to join an existing workspace.
  const invite = await findPendingInvite(db, user.email)
  if (invite) {
    const staff = await acceptInvite(db, invite, { authUserId: user.id, email: user.email, name: user.name })
    await issueStaffSession(event, staff)
    return { status: 'entered', joined: true }
  }

  // No membership, no invite: may they create their own org?
  if (isCreateAllowed(user.email)) return { status: 'create', email: user.email, name: user.name }
  return { status: 'ask_owner', email: user.email }
})
