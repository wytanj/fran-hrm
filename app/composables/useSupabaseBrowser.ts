// Browser-only Supabase client, used purely for Google SSO (sign-in + reading
// the resulting session token). The token is then handed to our own server,
// which verifies it and mints the normal fran_hrm_session cookie — so the rest
// of the app (requireActor, PIN login) is untouched.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function useSupabaseBrowser(): SupabaseClient {
  if (import.meta.server) throw new Error('useSupabaseBrowser is client-only')
  if (client) return client
  const cfg = useRuntimeConfig()
  client = createClient(cfg.public.supabaseUrl as string, cfg.public.supabaseAnonKey as string, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  })
  return client
}
