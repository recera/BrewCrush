import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that are always allowed, even in read-only mode
const ALWAYS_ALLOWED_ROUTES = [
  '/auth',
  '/api/auth',
  '/api/stripe',
  '/settings/billing',
  '/api/billing',
]

// Routes that require write access
const WRITE_ROUTES = [
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]

export async function checkBillingStatus(request: NextRequest) {
  const { pathname } = request.nextUrl
  const method = request.method

  // Always allow auth and billing routes
  if (ALWAYS_ALLOWED_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // Check if this is a write operation
  const isWriteOperation = WRITE_ROUTES.includes(method)

  if (!isWriteOperation) {
    return NextResponse.next()
  }

  const supabase = createClient()
  
  try {
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.next()
    }

    // Get workspace for user
    const { data: workspaceRole, error: roleError } = await supabase
      .from('user_workspace_roles')
      .select('workspace_id')
      .eq('user_id', user.id)
      .single()

    if (roleError || !workspaceRole) {
      return NextResponse.next()
    }

    // Check billing status
    const { data: billingStatus, error: billingError } = await supabase
      .rpc('get_workspace_billing_status', {
        p_workspace_id: workspaceRole.workspace_id
      })

    if (billingError || !billingStatus) {
      return NextResponse.next()
    }

    // Check if workspace is in read-only mode
    if (billingStatus.read_only_mode) {
      // For API routes, return error
      if (pathname.startsWith('/api')) {
        return NextResponse.json(
          { 
            error: 'Workspace is in read-only mode',
            reason: billingStatus.read_only_reason,
            message: getReadOnlyMessage(billingStatus.read_only_reason)
          },
          { status: 403 }
        )
      }

      // For page routes, redirect to billing page
      const url = request.nextUrl.clone()
      url.pathname = '/settings/billing'
      url.searchParams.set('alert', 'read_only')
      url.searchParams.set('reason', billingStatus.read_only_reason || 'payment_failed')
      return NextResponse.redirect(url)
    }

    // Check if trial has expired without subscription
    if (billingStatus.is_trial === false && 
        !billingStatus.stripe_subscription_id && 
        billingStatus.trial_ends_at && 
        new Date(billingStatus.trial_ends_at) < new Date()) {
      
      // Trial expired without subscription
      if (pathname.startsWith('/api')) {
        return NextResponse.json(
          { 
            error: 'Trial expired',
            message: 'Your trial has expired. Please upgrade to continue.'
          },
          { status: 403 }
        )
      }

      const url = request.nextUrl.clone()
      url.pathname = '/settings/billing'
      url.searchParams.set('alert', 'trial_expired')
      return NextResponse.redirect(url)
    }

    return NextResponse.next()
  } catch (error) {
    console.error('Billing middleware error:', error)
    return NextResponse.next()
  }
}

function getReadOnlyMessage(reason: string): string {
  switch (reason) {
    case 'payment_failed':
      return 'Your workspace is in read-only mode due to payment failure. Please update your payment method to restore full access.'
    case 'trial_expired':
      return 'Your trial has expired. Please upgrade to a paid plan to continue using BrewCrush.'
    case 'subscription_cancelled':
      return 'Your subscription has been cancelled. Please reactivate to restore full access.'
    case 'manual_suspension':
      return 'Your workspace has been temporarily suspended. Please contact support for assistance.'
    default:
      return 'Your workspace is currently in read-only mode. Please contact support for assistance.'
  }
}

// Hook to check billing status in components
export function useBillingStatus() {
  // This would be implemented as a React hook
  // For now, this is just a placeholder
  return {
    isReadOnly: false,
    readOnlyReason: null,
    isTrialExpired: false,
    trialEndsAt: null,
  }
}