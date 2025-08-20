'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/hooks/use-user'

interface BillingStatus {
  workspace_id: string
  plan_name: string
  billing_period: 'monthly' | 'annual'
  is_trial: boolean
  trial_ends_at: string | null
  renewal_at: string | null
  is_active: boolean
  read_only_mode: boolean
  read_only_reason: string | null
  stripe_subscription_id: string | null
}

export function useBillingStatus() {
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { user } = useUser()
  const supabase = createClient()

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }

    const fetchBillingStatus = async () => {
      try {
        // Get user's workspace
        const { data: workspaceRole, error: roleError } = await supabase
          .from('user_workspace_roles')
          .select('workspace_id')
          .eq('user_id', user.id)
          .single()

        if (roleError || !workspaceRole) {
          throw new Error('Could not find workspace')
        }

        // Get billing status
        const { data, error: statusError } = await supabase
          .rpc('get_workspace_billing_status', {
            p_workspace_id: workspaceRole.workspace_id
          })

        if (statusError) {
          throw statusError
        }

        setStatus(data)
      } catch (err: any) {
        console.error('Error fetching billing status:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchBillingStatus()

    // Subscribe to billing changes
    const subscription = supabase
      .channel('billing_status')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'account_billing',
        },
        () => {
          fetchBillingStatus()
        }
      )
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  }, [user])

  const isReadOnly = status?.read_only_mode || false
  const readOnlyReason = status?.read_only_reason || null
  const isTrialExpired = 
    status?.is_trial === false && 
    status?.trial_ends_at && 
    new Date(status.trial_ends_at) < new Date() &&
    !status?.stripe_subscription_id

  const trialDaysRemaining = status?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(status.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null

  return {
    status,
    loading,
    error,
    isReadOnly,
    readOnlyReason,
    isTrialExpired,
    trialDaysRemaining,
    isInTrial: status?.is_trial || false,
    planName: status?.plan_name || 'starter',
  }
}