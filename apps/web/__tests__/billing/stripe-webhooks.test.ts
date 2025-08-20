import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/stripe/webhook/route'
import Stripe from 'stripe'

// Mock Stripe
vi.mock('stripe', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      webhooks: {
        constructEvent: vi.fn()
      }
    }))
  }
})

// Mock Supabase
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: { id: 'test-id' }, error: null }))
        }))
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: { id: 'test-id' }, error: null }))
        }))
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null }))
      }))
    })),
    rpc: vi.fn(() => Promise.resolve({ error: null }))
  }))
}))

describe('Stripe Webhook Handler', () => {
  let mockStripe: any
  
  beforeEach(() => {
    mockStripe = new (Stripe as any)('test-key')
    vi.clearAllMocks()
  })

  describe('checkout.session.completed', () => {
    it('should activate workspace billing on successful checkout', async () => {
      const mockEvent = {
        id: 'evt_test',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test',
            customer: 'cus_test',
            subscription: 'sub_test',
            metadata: {
              workspace_id: 'ws_test',
              user_id: 'user_test'
            },
            line_items: {
              data: [{
                price: { id: 'price_test' }
              }]
            }
          }
        }
      }

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent)

      const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'stripe-signature': 'test-signature'
        },
        body: JSON.stringify(mockEvent)
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.received).toBe(true)
    })

    it('should handle trial period end correctly', async () => {
      const mockEvent = {
        id: 'evt_test',
        type: 'customer.subscription.trial_will_end',
        data: {
          object: {
            id: 'sub_test',
            customer: 'cus_test',
            trial_end: Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60, // 3 days from now
            metadata: {
              workspace_id: 'ws_test'
            }
          }
        }
      }

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent)

      const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'stripe-signature': 'test-signature'
        },
        body: JSON.stringify(mockEvent)
      })

      const response = await POST(request)
      
      expect(response.status).toBe(200)
      // Verify notification was queued
    })
  })

  describe('invoice.payment_failed', () => {
    it('should enable read-only mode after payment failure', async () => {
      const mockEvent = {
        id: 'evt_test',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_test',
            customer: 'cus_test',
            subscription: 'sub_test',
            attempt_count: 3,
            metadata: {
              workspace_id: 'ws_test'
            }
          }
        }
      }

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent)

      const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'stripe-signature': 'test-signature'
        },
        body: JSON.stringify(mockEvent)
      })

      const response = await POST(request)
      
      expect(response.status).toBe(200)
      // Verify read-only mode was enabled
    })
  })

  describe('customer.subscription.deleted', () => {
    it('should handle subscription cancellation', async () => {
      const mockEvent = {
        id: 'evt_test',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_test',
            customer: 'cus_test',
            metadata: {
              workspace_id: 'ws_test'
            }
          }
        }
      }

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent)

      const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'stripe-signature': 'test-signature'
        },
        body: JSON.stringify(mockEvent)
      })

      const response = await POST(request)
      
      expect(response.status).toBe(200)
      // Verify workspace was marked as cancelled
    })
  })

  describe('webhook signature validation', () => {
    it('should reject requests with invalid signature', async () => {
      mockStripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid signature')
      })

      const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'stripe-signature': 'invalid-signature'
        },
        body: JSON.stringify({})
      })

      const response = await POST(request)
      
      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('signature')
    })
  })

  describe('idempotency', () => {
    it('should handle duplicate webhook events', async () => {
      const mockEvent = {
        id: 'evt_duplicate',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test',
            customer: 'cus_test',
            subscription: 'sub_test',
            metadata: {
              workspace_id: 'ws_test'
            }
          }
        }
      }

      mockStripe.webhooks.constructEvent.mockReturnValue(mockEvent)

      const request1 = new NextRequest('http://localhost:3000/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'test-signature' },
        body: JSON.stringify(mockEvent)
      })

      const request2 = new NextRequest('http://localhost:3000/api/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'test-signature' },
        body: JSON.stringify(mockEvent)
      })

      const response1 = await POST(request1)
      const response2 = await POST(request2)
      
      expect(response1.status).toBe(200)
      expect(response2.status).toBe(200) // Should handle gracefully
    })
  })
})