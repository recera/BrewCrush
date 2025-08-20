import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SignupPage from '@/app/auth/signup/page'
import { useRouter } from 'next/navigation'

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(() => ({
    get: vi.fn()
  }))
}))

// Mock Supabase client
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signUp: vi.fn(),
      getUser: vi.fn()
    },
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: {}, error: null }))
        }))
      }))
    })),
    rpc: vi.fn()
  }))
}))

describe('Signup Flow with BBL Attestation', () => {
  const mockPush = vi.fn()
  const user = userEvent.setup()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useRouter as any).mockReturnValue({
      push: mockPush
    })
  })

  describe('Account Details Step', () => {
    it('should display account form fields', () => {
      render(<SignupPage />)
      
      expect(screen.getByLabelText(/full name/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/brewery name/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument()
    })

    it('should validate password requirements', async () => {
      render(<SignupPage />)
      
      const passwordInput = screen.getByLabelText(/^password$/i)
      const confirmInput = screen.getByLabelText(/confirm password/i)
      const continueButton = screen.getByRole('button', { name: /continue/i })

      // Fill in required fields
      await user.type(screen.getByLabelText(/full name/i), 'John Doe')
      await user.type(screen.getByLabelText(/brewery name/i), 'Test Brewery')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      
      // Test short password
      await user.type(passwordInput, 'short')
      await user.type(confirmInput, 'short')
      await user.click(continueButton)
      
      expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument()
      
      // Test password mismatch
      await user.clear(passwordInput)
      await user.clear(confirmInput)
      await user.type(passwordInput, 'password123')
      await user.type(confirmInput, 'password456')
      await user.click(continueButton)
      
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument()
    })

    it('should proceed to production step with valid data', async () => {
      render(<SignupPage />)
      
      // Fill in valid account details
      await user.type(screen.getByLabelText(/full name/i), 'John Doe')
      await user.type(screen.getByLabelText(/brewery name/i), 'Test Brewery')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.type(screen.getByLabelText(/confirm password/i), 'password123')
      
      const continueButton = screen.getByRole('button', { name: /continue/i })
      await user.click(continueButton)
      
      // Should show production step
      await waitFor(() => {
        expect(screen.getByText(/how many bbl did you produce/i)).toBeInTheDocument()
      })
    })
  })

  describe('Production & Plan Step', () => {
    beforeEach(async () => {
      render(<SignupPage />)
      
      // Fill in account details and proceed to production step
      await user.type(screen.getByLabelText(/full name/i), 'John Doe')
      await user.type(screen.getByLabelText(/brewery name/i), 'Test Brewery')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.type(screen.getByLabelText(/confirm password/i), 'password123')
      
      const continueButton = screen.getByRole('button', { name: /continue/i })
      await user.click(continueButton)
    })

    it('should display BBL tier options', async () => {
      await waitFor(() => {
        expect(screen.getByText(/≤ 1,000 BBL\/year/i)).toBeInTheDocument()
        expect(screen.getByText(/1,001–3,500 BBL\/year/i)).toBeInTheDocument()
        expect(screen.getByText(/3,501–10,000 BBL\/year/i)).toBeInTheDocument()
      })
    })

    it('should show billing period toggle after selecting tier', async () => {
      const starterOption = screen.getByText(/≤ 1,000 BBL\/year/i).closest('div')
      await user.click(starterOption!)
      
      await waitFor(() => {
        expect(screen.getByText(/choose your billing period/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /monthly/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /annual/i })).toBeInTheDocument()
      })
    })

    it('should display plan summary with pricing', async () => {
      const starterOption = screen.getByText(/≤ 1,000 BBL\/year/i).closest('div')
      await user.click(starterOption!)
      
      await waitFor(() => {
        expect(screen.getByText(/starter plan/i)).toBeInTheDocument()
        expect(screen.getByText(/\$40/)).toBeInTheDocument() // Monthly price
      })
      
      // Switch to annual
      const annualButton = screen.getByRole('button', { name: /annual/i })
      await user.click(annualButton)
      
      await waitFor(() => {
        expect(screen.getByText(/\$34/)).toBeInTheDocument() // Annual price
      })
    })

    it('should require attestation checkbox', async () => {
      const starterOption = screen.getByText(/≤ 1,000 BBL\/year/i).closest('div')
      await user.click(starterOption!)
      
      const submitButton = screen.getByRole('button', { name: /start free trial/i })
      
      // Should be disabled without attestation
      expect(submitButton).toBeDisabled()
      
      // Check attestation
      const attestation = screen.getByRole('checkbox')
      await user.click(attestation)
      
      // Should be enabled with attestation
      expect(submitButton).not.toBeDisabled()
    })

    it('should allow going back to account step', async () => {
      const backButton = screen.getByRole('button', { name: /back/i })
      await user.click(backButton)
      
      // Should be back on account step
      expect(screen.getByLabelText(/full name/i)).toBeInTheDocument()
    })
  })

  describe('Form Submission', () => {
    it('should submit with all required data', async () => {
      const mockSignUp = vi.fn().mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      
      const mockSupabase = {
        auth: {
          signUp: mockSignUp
        },
        from: vi.fn(() => ({
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve({ data: {}, error: null }))
            }))
          }))
        }))
      }
      
      vi.mocked(createClient).mockReturnValue(mockSupabase as any)
      
      render(<SignupPage />)
      
      // Fill account details
      await user.type(screen.getByLabelText(/full name/i), 'John Doe')
      await user.type(screen.getByLabelText(/brewery name/i), 'Test Brewery')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.type(screen.getByLabelText(/confirm password/i), 'password123')
      
      await user.click(screen.getByRole('button', { name: /continue/i }))
      
      // Select production tier
      await waitFor(() => screen.getByText(/how many bbl/i))
      const growthOption = screen.getByText(/1,001–3,500 BBL\/year/i).closest('div')
      await user.click(growthOption!)
      
      // Select annual billing
      const annualButton = screen.getByRole('button', { name: /annual/i })
      await user.click(annualButton)
      
      // Check attestation
      const attestation = screen.getByRole('checkbox')
      await user.click(attestation)
      
      // Submit
      const submitButton = screen.getByRole('button', { name: /start free trial/i })
      await user.click(submitButton)
      
      await waitFor(() => {
        expect(mockSignUp).toHaveBeenCalledWith({
          email: 'test@example.com',
          password: 'password123',
          options: {
            data: {
              full_name: 'John Doe',
              brewery_name: 'Test Brewery',
              bbl_tier: 'growth',
              billing_period: 'annual'
            }
          }
        })
        
        expect(mockPush).toHaveBeenCalledWith(
          expect.stringContaining('/onboarding')
        )
      })
    })

    it('should handle signup errors', async () => {
      const mockSignUp = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Email already in use' }
      })
      
      vi.mocked(createClient).mockReturnValue({
        auth: { signUp: mockSignUp }
      } as any)
      
      render(<SignupPage />)
      
      // Fill and submit form quickly
      await user.type(screen.getByLabelText(/full name/i), 'John Doe')
      await user.type(screen.getByLabelText(/brewery name/i), 'Test Brewery')
      await user.type(screen.getByLabelText(/email/i), 'test@example.com')
      await user.type(screen.getByLabelText(/^password$/i), 'password123')
      await user.type(screen.getByLabelText(/confirm password/i), 'password123')
      await user.click(screen.getByRole('button', { name: /continue/i }))
      
      await waitFor(() => screen.getByText(/how many bbl/i))
      const starterOption = screen.getByText(/≤ 1,000 BBL\/year/i).closest('div')
      await user.click(starterOption!)
      await user.click(screen.getByRole('checkbox'))
      await user.click(screen.getByRole('button', { name: /start free trial/i }))
      
      await waitFor(() => {
        expect(screen.getByText(/email already in use/i)).toBeInTheDocument()
      })
    })
  })
})