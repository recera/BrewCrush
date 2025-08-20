import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  getOrCreateStripeCustomer, 
  createCheckoutSession,
  createSetupCheckoutSession,
  STRIPE_PRODUCTS 
} from '@/lib/stripe/server'

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
  const { 
    planName, 
    billingPeriod, 
    workspaceId,
    setupPackage,
    successUrl = '/dashboard?checkout=success',
    cancelUrl = '/settings/billing'
  } = body

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

  // Get or create Stripe customer
  let customerId: string
  
  const { data: billing } = await supabase
    .from('account_billing')
    .select('stripe_customer_id')
    .eq('workspace_id', workspaceId)
    .single()

  if (billing?.stripe_customer_id) {
    customerId = billing.stripe_customer_id
  } else {
    // Get workspace details
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('name')
      .eq('id', workspaceId)
      .single()

    customerId = await getOrCreateStripeCustomer(
      user.email!,
      workspaceId,
      workspace?.name
    )

    // Store customer ID
    await supabase
      .from('account_billing')
      .upsert({
        workspace_id: workspaceId,
        stripe_customer_id: customerId,
        plan_id: (await supabase
          .from('billing_plans')
          .select('id')
          .eq('name', 'trial')
          .single()).data?.id,
        billing_period: 'monthly',
      }, {
        onConflict: 'workspace_id',
      })
  }

  try {
    let session

    if (setupPackage) {
      // Handle setup package purchase
      const priceId = STRIPE_PRODUCTS.setup[setupPackage as keyof typeof STRIPE_PRODUCTS.setup]
      if (!priceId) {
        return NextResponse.json(
          { error: 'Invalid setup package' },
          { status: 400 }
        )
      }

      session = await createSetupCheckoutSession({
        customerId,
        priceId,
        workspaceId,
        successUrl: `${process.env.NEXT_PUBLIC_APP_URL}${successUrl}`,
        cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}${cancelUrl}`,
      })
    } else {
      // Handle subscription
      if (!planName || !billingPeriod) {
        return NextResponse.json(
          { error: 'Missing plan or billing period' },
          { status: 400 }
        )
      }

      const priceId = STRIPE_PRODUCTS[planName as keyof typeof STRIPE_PRODUCTS]?.[billingPeriod as 'monthly' | 'annual']
      if (!priceId) {
        return NextResponse.json(
          { error: 'Invalid plan or billing period' },
          { status: 400 }
        )
      }

      // Check if in trial
      const { data: currentBilling } = await supabase
        .from('account_billing')
        .select('trial_ends_at')
        .eq('workspace_id', workspaceId)
        .single()

      const trialDays = currentBilling?.trial_ends_at && new Date(currentBilling.trial_ends_at) > new Date()
        ? Math.ceil((new Date(currentBilling.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : 14

      session = await createCheckoutSession({
        customerId,
        priceId,
        workspaceId,
        successUrl: `${process.env.NEXT_PUBLIC_APP_URL}${successUrl}`,
        cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}${cancelUrl}`,
        trialDays,
      })
    }

    return NextResponse.json({ 
      sessionId: session.id,
      url: session.url 
    })
  } catch (error) {
    console.error('Error creating checkout session:', error)
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}