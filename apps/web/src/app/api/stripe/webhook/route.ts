import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { constructWebhookEvent, stripe } from '@/lib/stripe/server'
import { createClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

// Stripe webhook handler
export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = headers().get('stripe-signature')

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    )
  }

  let event: Stripe.Event

  try {
    event = constructWebhookEvent(body, signature)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    )
  }

  const supabase = createClient()

  // Check if we've already processed this event (idempotency)
  const { data: existingEvent } = await supabase
    .from('stripe_webhook_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .single()

  if (existingEvent) {
    console.log('Event already processed:', event.id)
    return NextResponse.json({ received: true })
  }

  // Store the event
  await supabase.from('stripe_webhook_events').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    payload: event as any,
  })

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutSessionCompleted(session, supabase)
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        await handleSubscriptionUpdate(subscription, supabase)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        await handleSubscriptionDeleted(subscription, supabase)
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        await handleInvoicePaymentSucceeded(invoice, supabase)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        await handleInvoicePaymentFailed(invoice, supabase)
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    // Mark event as processed
    await supabase
      .from('stripe_webhook_events')
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
      })
      .eq('stripe_event_id', event.id)

  } catch (error) {
    console.error('Error processing webhook:', error)
    
    // Log error but don't fail the webhook
    await supabase
      .from('stripe_webhook_events')
      .update({
        error: String(error),
        processed_at: new Date().toISOString(),
      })
      .eq('stripe_event_id', event.id)
  }

  return NextResponse.json({ received: true })
}

async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  supabase: any
) {
  const workspaceId = session.metadata?.workspace_id
  if (!workspaceId) {
    console.error('No workspace_id in session metadata')
    return
  }

  // Check if this is a setup package purchase
  if (session.metadata?.type === 'setup_package') {
    // Handle setup package purchase
    await supabase.from('setup_package_purchases').insert({
      workspace_id: workspaceId,
      stripe_payment_intent_id: session.payment_intent as string,
      amount_paid: session.amount_total || 0,
      status: 'succeeded',
      purchased_at: new Date().toISOString(),
    })
    return
  }

  // Handle subscription creation
  if (session.subscription) {
    const subscription = await stripe.subscriptions.retrieve(
      session.subscription as string
    )

    // Determine the plan based on the price ID
    const priceId = subscription.items.data[0].price.id
    const { data: plan } = await determinePlanFromPriceId(priceId, supabase)

    if (!plan) {
      console.error('Could not determine plan from price:', priceId)
      return
    }

    // Update or create account billing
    await supabase.from('account_billing').upsert({
      workspace_id: workspaceId,
      plan_id: plan.id,
      billing_period: subscription.items.data[0].price.recurring?.interval === 'year' ? 'annual' : 'monthly',
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: subscription.id,
      trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
      renewal_at: new Date(subscription.current_period_end * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'workspace_id',
    })
  }
}

async function handleSubscriptionUpdate(
  subscription: Stripe.Subscription,
  supabase: any
) {
  const workspaceId = subscription.metadata?.workspace_id
  if (!workspaceId) return

  const priceId = subscription.items.data[0].price.id
  const { data: plan } = await determinePlanFromPriceId(priceId, supabase)

  if (!plan) {
    console.error('Could not determine plan from price:', priceId)
    return
  }

  await supabase.from('account_billing').update({
    plan_id: plan.id,
    billing_period: subscription.items.data[0].price.recurring?.interval === 'year' ? 'annual' : 'monthly',
    stripe_subscription_id: subscription.id,
    trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
    renewal_at: new Date(subscription.current_period_end * 1000).toISOString(),
    canceled_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('workspace_id', workspaceId)
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  supabase: any
) {
  const workspaceId = subscription.metadata?.workspace_id
  if (!workspaceId) return

  // Move to trial/free plan
  const { data: trialPlan } = await supabase
    .from('billing_plans')
    .select('id')
    .eq('name', 'trial')
    .single()

  if (trialPlan) {
    await supabase.from('account_billing').update({
      plan_id: trialPlan.id,
      stripe_subscription_id: null,
      canceled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('workspace_id', workspaceId)
  }
}

async function handleInvoicePaymentSucceeded(
  invoice: Stripe.Invoice,
  supabase: any
) {
  const workspaceId = invoice.subscription_details?.metadata?.workspace_id
  if (!workspaceId) return

  // Store invoice record
  await supabase.from('invoices').insert({
    workspace_id: workspaceId,
    stripe_invoice_id: invoice.id,
    invoice_number: invoice.number,
    amount_due: invoice.amount_due,
    amount_paid: invoice.amount_paid,
    currency: invoice.currency,
    status: 'succeeded',
    period_start: new Date(invoice.period_start * 1000).toISOString(),
    period_end: new Date(invoice.period_end * 1000).toISOString(),
    paid_at: invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000).toISOString() : null,
    pdf_url: invoice.invoice_pdf,
    hosted_invoice_url: invoice.hosted_invoice_url,
  })

  // Clear read-only mode if it was due to payment issues
  await supabase.from('account_billing').update({
    read_only_mode: false,
    read_only_reason: null,
    updated_at: new Date().toISOString(),
  }).eq('workspace_id', workspaceId)
    .eq('read_only_reason', 'payment_failed')
}

async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  supabase: any
) {
  const workspaceId = invoice.subscription_details?.metadata?.workspace_id
  if (!workspaceId) return

  // Store failed invoice
  await supabase.from('invoices').insert({
    workspace_id: workspaceId,
    stripe_invoice_id: invoice.id,
    invoice_number: invoice.number,
    amount_due: invoice.amount_due,
    amount_paid: 0,
    currency: invoice.currency,
    status: 'failed',
    period_start: new Date(invoice.period_start * 1000).toISOString(),
    period_end: new Date(invoice.period_end * 1000).toISOString(),
    pdf_url: invoice.invoice_pdf,
    hosted_invoice_url: invoice.hosted_invoice_url,
  })

  // After 3 failed attempts, enable read-only mode
  const { count } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'failed')
    .gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()) // Last 14 days

  if (count >= 3) {
    await supabase.from('account_billing').update({
      read_only_mode: true,
      read_only_reason: 'payment_failed',
      updated_at: new Date().toISOString(),
    }).eq('workspace_id', workspaceId)
  }
}

async function determinePlanFromPriceId(priceId: string, supabase: any) {
  // Map price IDs to plan names
  // In production, these would come from environment variables
  const priceMap: Record<string, string> = {
    [process.env.STRIPE_PRICE_STARTER_MONTHLY || '']: 'starter',
    [process.env.STRIPE_PRICE_STARTER_ANNUAL || '']: 'starter',
    [process.env.STRIPE_PRICE_GROWTH_MONTHLY || '']: 'growth',
    [process.env.STRIPE_PRICE_GROWTH_ANNUAL || '']: 'growth',
    [process.env.STRIPE_PRICE_PRO_MONTHLY || '']: 'pro',
    [process.env.STRIPE_PRICE_PRO_ANNUAL || '']: 'pro',
  }

  const planName = priceMap[priceId]
  if (!planName) return { data: null }

  return await supabase
    .from('billing_plans')
    .select('id')
    .eq('name', planName)
    .single()
}