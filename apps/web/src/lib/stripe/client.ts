import { loadStripe, Stripe } from '@stripe/stripe-js'

let stripePromise: Promise<Stripe | null>

export function getStripe() {
  if (!stripePromise) {
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    if (!publishableKey) {
      console.error('Missing Stripe publishable key')
      return null
    }
    stripePromise = loadStripe(publishableKey)
  }
  return stripePromise
}

export async function redirectToCheckout(sessionId: string) {
  const stripe = await getStripe()
  if (!stripe) {
    throw new Error('Stripe not initialized')
  }

  const { error } = await stripe.redirectToCheckout({ sessionId })
  if (error) {
    throw error
  }
}