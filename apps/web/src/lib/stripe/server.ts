import Stripe from 'stripe'
import { getEnv } from '@/lib/env'

// Initialize Stripe with TypeScript support
export const stripe = new Stripe(getEnv('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2025-01-27.acacia' as any, // Use latest API version
  typescript: true,
})

// Product/Price IDs (these will be created in Stripe Dashboard or via API)
export const STRIPE_PRODUCTS = {
  starter: {
    monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_STARTER_ANNUAL || '',
  },
  growth: {
    monthly: process.env.STRIPE_PRICE_GROWTH_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_GROWTH_ANNUAL || '',
  },
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_PRO_ANNUAL || '',
  },
  setup: {
    basic: process.env.STRIPE_PRICE_SETUP_BASIC || '',
    whiteGlove: process.env.STRIPE_PRICE_SETUP_WHITE_GLOVE || '',
    legacySwitch: process.env.STRIPE_PRICE_SETUP_LEGACY_SWITCH || '',
  },
}

// Helper to create or retrieve a Stripe customer
export async function getOrCreateStripeCustomer(
  email: string,
  workspaceId: string,
  name?: string
): Promise<string> {
  // First, check if customer already exists
  const existingCustomers = await stripe.customers.list({
    email,
    limit: 1,
  })

  if (existingCustomers.data.length > 0) {
    const customer = existingCustomers.data[0]
    // Update metadata if workspace ID is different
    if (customer.metadata?.workspace_id !== workspaceId) {
      await stripe.customers.update(customer.id, {
        metadata: {
          workspace_id: workspaceId,
        },
      })
    }
    return customer.id
  }

  // Create new customer
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: {
      workspace_id: workspaceId,
    },
  })

  return customer.id
}

// Create a checkout session for subscription
export async function createCheckoutSession({
  customerId,
  priceId,
  workspaceId,
  successUrl,
  cancelUrl,
  trialDays = 14,
}: {
  customerId: string
  priceId: string
  workspaceId: string
  successUrl: string
  cancelUrl: string
  trialDays?: number
}) {
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      trial_period_days: trialDays,
      metadata: {
        workspace_id: workspaceId,
      },
    },
    metadata: {
      workspace_id: workspaceId,
    },
  })

  return session
}

// Create a checkout session for one-time setup package
export async function createSetupCheckoutSession({
  customerId,
  priceId,
  workspaceId,
  successUrl,
  cancelUrl,
}: {
  customerId: string
  priceId: string
  workspaceId: string
  successUrl: string
  cancelUrl: string
}) {
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      workspace_id: workspaceId,
      type: 'setup_package',
    },
  })

  return session
}

// Create a billing portal session
export async function createBillingPortalSession({
  customerId,
  returnUrl,
}: {
  customerId: string
  returnUrl: string
}) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })

  return session
}

// Cancel subscription (with option to cancel at period end)
export async function cancelSubscription(
  subscriptionId: string,
  cancelAtPeriodEnd = true
) {
  if (cancelAtPeriodEnd) {
    return await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    })
  } else {
    return await stripe.subscriptions.cancel(subscriptionId)
  }
}

// Update subscription (for plan changes)
export async function updateSubscription(
  subscriptionId: string,
  newPriceId: string,
  prorationBehavior: 'create_prorations' | 'none' = 'create_prorations'
) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const itemId = subscription.items.data[0].id

  return await stripe.subscriptions.update(subscriptionId, {
    items: [
      {
        id: itemId,
        price: newPriceId,
      },
    ],
    proration_behavior: prorationBehavior,
  })
}

// Verify webhook signature
export function constructWebhookEvent(
  payload: Buffer | string,
  signature: string
): Stripe.Event {
  const webhookSecret = getEnv('STRIPE_WEBHOOK_SECRET')
  if (!webhookSecret) {
    throw new Error('Missing Stripe webhook secret')
  }

  return stripe.webhooks.constructEvent(payload, signature, webhookSecret)
}