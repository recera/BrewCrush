import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createBillingPortalSession } from '@/lib/stripe/server'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  
  // Check authentication
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const body = await request.json()
  const { workspaceId } = body

  // Verify user has access to workspace
  const { data: role } = await supabase
    .from('user_workspace_roles')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .single()

  if (!role || role.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins can manage billing' },
      { status: 403 }
    )
  }

  // Get Stripe customer ID
  const { data: billing } = await supabase
    .from('account_billing')
    .select('stripe_customer_id')
    .eq('workspace_id', workspaceId)
    .single()

  if (!billing?.stripe_customer_id) {
    return NextResponse.json(
      { error: 'No billing account found' },
      { status: 404 }
    )
  }

  try {
    const session = await createBillingPortalSession({
      customerId: billing.stripe_customer_id,
      returnUrl: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing`,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Error creating billing portal session:', error)
    return NextResponse.json(
      { error: 'Failed to create billing portal session' },
      { status: 500 }
    )
  }
}