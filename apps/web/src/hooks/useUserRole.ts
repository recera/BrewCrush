'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useUserRole() {
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetchUserRole() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        
        if (!user) {
          setRole(null)
          setLoading(false)
          return
        }

        const { data, error } = await supabase
          .from('user_workspace_roles')
          .select('role')
          .eq('user_id', user.id)
          .single()

        if (error) {
          console.error('Error fetching user role:', error)
          setRole(null)
        } else {
          setRole(data?.role || null)
        }
      } catch (error) {
        console.error('Error fetching user role:', error)
        setRole(null)
      } finally {
        setLoading(false)
      }
    }

    fetchUserRole()
  }, [supabase])

  // Determine if user can view costs based on role
  const canViewCosts = role === 'admin' || role === 'accounting' || role === 'inventory'

  return { role, loading, canViewCosts }
}