import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr'
import { Database } from '@/types/database'
import { env } from '@/lib/env'

export function createClient() {
  return createSupabaseBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}

// Alias for consistency with existing code
export const createBrowserClient = createClient

// Hook-like wrapper for compatibility
export const useSupabase = createClient