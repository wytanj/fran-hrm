// Service-role Supabase client (server only). RLS is enabled with zero
// policies on every table, so this client is the only way in — tenancy is
// enforced in code by always filtering on workspace_id.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function getAdminClient(): SupabaseClient {
  if (client) return client
  const config = useRuntimeConfig()
  const url = config.supabaseUrl || process.env.SUPABASE_URL
  const key = config.supabaseServiceKey || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY not configured')
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}
