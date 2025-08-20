import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { checkBillingStatus } from '@/lib/billing/middleware'
import { createClient } from '@/lib/supabase/server'

// Mock Supabase
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn()
}))

describe('Read-Only Mode Enforcement', () => {
  let mockSupabase: any

  beforeEach(() => {
    mockSupabase = {
      auth: {
        getUser: vi.fn()
      },
      from: vi.fn(),
      rpc: vi.fn()
    }
    vi.mocked(createClient).mockReturnValue(mockSupabase)
  })

  describe('checkBillingStatus middleware', () => {
    it('should allow read operations in read-only mode', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { workspace_id: 'ws-123' },
              error: null
            })
          })
        })
      })

      mockSupabase.rpc.mockResolvedValue({
        data: {
          read_only_mode: true,
          read_only_reason: 'payment_failed'
        },
        error: null
      })

      const request = new NextRequest('http://localhost:3000/api/items', {
        method: 'GET'
      })

      const response = await checkBillingStatus(request)
      expect(response.status).toBe(200)
    })

    it('should block write operations in read-only mode', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { workspace_id: 'ws-123' },
              error: null
            })
          })
        })
      })

      mockSupabase.rpc.mockResolvedValue({
        data: {
          read_only_mode: true,
          read_only_reason: 'payment_failed'
        },
        error: null
      })

      const request = new NextRequest('http://localhost:3000/api/items', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Item' })
      })

      const response = await checkBillingStatus(request)
      expect(response.status).toBe(403)
      
      const data = await response.json()
      expect(data.error).toContain('read-only mode')
      expect(data.reason).toBe('payment_failed')
    })

    it('should allow billing-related routes in read-only mode', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      const request = new NextRequest('http://localhost:3000/settings/billing', {
        method: 'POST'
      })

      const response = await checkBillingStatus(request)
      expect(response.status).toBe(200)
    })

    it('should allow Stripe webhook routes in read-only mode', async () => {
      const request = new NextRequest('http://localhost:3000/api/stripe/webhook', {
        method: 'POST'
      })

      const response = await checkBillingStatus(request)
      expect(response.status).toBe(200)
    })

    it('should redirect page routes to billing in read-only mode', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { workspace_id: 'ws-123' },
              error: null
            })
          })
        })
      })

      mockSupabase.rpc.mockResolvedValue({
        data: {
          read_only_mode: true,
          read_only_reason: 'payment_failed'
        },
        error: null
      })

      const request = new NextRequest('http://localhost:3000/production/batches/new', {
        method: 'POST'
      })

      const response = await checkBillingStatus(request)
      expect(response.status).toBe(307) // Redirect
      expect(response.headers.get('location')).toContain('/settings/billing')
      expect(response.headers.get('location')).toContain('alert=read_only')
    })
  })

  describe('Trial Expiration', () => {
    it('should block writes when trial expired without subscription', async () => {
      const expiredDate = new Date()
      expiredDate.setDate(expiredDate.getDate() - 1)

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { workspace_id: 'ws-123' },
              error: null
            })
          })
        })
      })

      mockSupabase.rpc.mockResolvedValue({
        data: {
          read_only_mode: false,
          is_trial: false,
          trial_ends_at: expiredDate.toISOString(),
          stripe_subscription_id: null
        },
        error: null
      })

      const request = new NextRequest('http://localhost:3000/api/items', {
        method: 'POST'
      })

      const response = await checkBillingStatus(request)
      expect(response.status).toBe(403)
      
      const data = await response.json()
      expect(data.error).toContain('Trial expired')
    })

    it('should allow operations during active trial', async () => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 7)

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { workspace_id: 'ws-123' },
              error: null
            })
          })
        })
      })

      mockSupabase.rpc.mockResolvedValue({
        data: {
          read_only_mode: false,
          is_trial: true,
          trial_ends_at: futureDate.toISOString(),
          stripe_subscription_id: null
        },
        error: null
      })

      const request = new NextRequest('http://localhost:3000/api/items', {
        method: 'POST'
      })

      const response = await checkBillingStatus(request)
      expect(response.status).toBe(200)
    })

    it('should allow operations with active subscription', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { workspace_id: 'ws-123' },
              error: null
            })
          })
        })
      })

      mockSupabase.rpc.mockResolvedValue({
        data: {
          read_only_mode: false,
          is_trial: false,
          trial_ends_at: null,
          stripe_subscription_id: 'sub_123'
        },
        error: null
      })

      const request = new NextRequest('http://localhost:3000/api/items', {
        method: 'POST'
      })

      const response = await checkBillingStatus(request)
      expect(response.status).toBe(200)
    })
  })

  describe('Read-Only Reasons', () => {
    const reasons = [
      { reason: 'payment_failed', message: 'payment failure' },
      { reason: 'trial_expired', message: 'trial has expired' },
      { reason: 'subscription_cancelled', message: 'subscription has been cancelled' },
      { reason: 'manual_suspension', message: 'temporarily suspended' }
    ]

    reasons.forEach(({ reason, message }) => {
      it(`should provide correct message for ${reason}`, async () => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null
        })

        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { workspace_id: 'ws-123' },
                error: null
              })
            })
          })
        })

        mockSupabase.rpc.mockResolvedValue({
          data: {
            read_only_mode: true,
            read_only_reason: reason
          },
          error: null
        })

        const request = new NextRequest('http://localhost:3000/api/items', {
          method: 'POST'
        })

        const response = await checkBillingStatus(request)
        const data = await response.json()
        
        expect(data.message.toLowerCase()).toContain(message)
      })
    })
  })
})