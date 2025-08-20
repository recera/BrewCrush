'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@brewcrush/ui'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Check, AlertCircle } from 'lucide-react'

type PlanTier = 'starter' | 'growth' | 'pro'
type BillingPeriod = 'monthly' | 'annual'

const PLAN_DETAILS = {
  starter: {
    name: 'Starter',
    bblRange: '≤ 1,000 BBL/year',
    monthlyPrice: 40,
    annualPrice: 34,
  },
  growth: {
    name: 'Growth',
    bblRange: '1,001–3,500 BBL/year',
    monthlyPrice: 85,
    annualPrice: 72,
  },
  pro: {
    name: 'Pro',
    bblRange: '3,501–10,000 BBL/year',
    monthlyPrice: 200,
    annualPrice: 170,
  },
}

export default function SignupPage() {
  const [step, setStep] = useState<'account' | 'production'>('account')
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    fullName: '',
    breweryName: '',
  })
  const [productionData, setProductionData] = useState({
    bblTier: '' as PlanTier | '',
    attestation: false,
    billingPeriod: 'monthly' as BillingPeriod,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validate passwords match
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    // Validate password strength (at least 8 characters)
    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setStep('production')
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Validate BBL selection and attestation
    if (!productionData.bblTier) {
      setError('Please select your annual production level')
      setLoading(false)
      return
    }

    if (!productionData.attestation) {
      setError('Please confirm your production level is accurate')
      setLoading(false)
      return
    }

    try {
      // Sign up the user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            full_name: formData.fullName,
            brewery_name: formData.breweryName,
            bbl_tier: productionData.bblTier,
            billing_period: productionData.billingPeriod,
          },
        },
      })

      if (authError) throw authError

      if (!authData.user) {
        throw new Error('User creation failed')
      }

      // Create user profile
      const { error: profileError } = await supabase
        .from('users')
        .insert({
          id: authData.user.id,
          email: formData.email,
          full_name: formData.fullName,
        })

      if (profileError) throw profileError

      // User will be redirected to onboarding with billing info
      const params = new URLSearchParams({
        workspace: formData.breweryName,
        plan: productionData.bblTier,
        billing: productionData.billingPeriod,
      })
      router.push('/onboarding?' + params.toString())
    } catch (error: any) {
      setError(error.message || 'An error occurred during signup')
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
  }

  const selectedPlan = productionData.bblTier ? PLAN_DETAILS[productionData.bblTier] : null
  const displayPrice = selectedPlan
    ? productionData.billingPeriod === 'monthly'
      ? selectedPlan.monthlyPrice
      : selectedPlan.annualPrice
    : 0

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-lg space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-bold tracking-tight">
            Start your free trial
          </h2>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            14 days free • No credit card required • Unlimited users
          </p>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/auth/login" className="font-medium text-primary hover:text-primary/90">
              Sign in
            </Link>
          </p>
        </div>

        {/* Progress indicators */}
        <div className="flex items-center justify-center space-x-4">
          <div className="flex items-center">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
              step === 'account' ? 'bg-primary text-primary-foreground' : 'bg-primary/20 text-primary'
            }`}>
              1
            </div>
            <span className="ml-2 text-sm font-medium">Account Details</span>
          </div>
          <div className="h-px w-12 bg-border" />
          <div className="flex items-center">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
              step === 'production' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}>
              2
            </div>
            <span className="ml-2 text-sm font-medium">Production & Plan</span>
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3">
            <p className="text-sm text-destructive flex items-center">
              <AlertCircle className="mr-2 h-4 w-4" />
              {error}
            </p>
          </div>
        )}

        {step === 'account' ? (
          <form className="mt-8 space-y-6" onSubmit={handleNextStep}>
            <div className="space-y-4">
              <div>
                <label htmlFor="fullName" className="block text-sm font-medium">
                  Full Name
                </label>
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  required
                  value={formData.fullName}
                  onChange={handleInputChange}
                  className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label htmlFor="breweryName" className="block text-sm font-medium">
                  Brewery Name
                </label>
                <input
                  id="breweryName"
                  name="breweryName"
                  type="text"
                  required
                  value={formData.breweryName}
                  onChange={handleInputChange}
                  className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Craft Brewery Co."
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium">
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={formData.email}
                  onChange={handleInputChange}
                  className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="brewery@example.com"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={formData.password}
                  onChange={handleInputChange}
                  className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="••••••••"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Must be at least 8 characters
                </p>
              </div>
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div>
              <Button type="submit" className="w-full">
                Continue
              </Button>
            </div>
          </form>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleSignup}>
            <div className="space-y-6">
              {/* BBL Selection */}
              <div>
                <label className="block text-sm font-medium mb-3">
                  How many BBL did you produce in the last 12 months?
                </label>
                <div className="grid grid-cols-1 gap-3">
                  {Object.entries(PLAN_DETAILS).map(([tier, details]) => (
                    <Card 
                      key={tier}
                      className={`cursor-pointer transition-all ${
                        productionData.bblTier === tier 
                          ? 'border-primary ring-2 ring-primary/20' 
                          : 'hover:border-primary/50'
                      }`}
                      onClick={() => setProductionData({ ...productionData, bblTier: tier as PlanTier })}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center">
                              <div className={`mr-3 h-5 w-5 rounded-full border-2 ${
                                productionData.bblTier === tier
                                  ? 'border-primary bg-primary'
                                  : 'border-muted-foreground'
                              }`}>
                                {productionData.bblTier === tier && (
                                  <Check className="h-3 w-3 text-primary-foreground" />
                                )}
                              </div>
                              <div>
                                <p className="font-medium">{details.bblRange}</p>
                                <p className="text-sm text-muted-foreground">
                                  {details.name} Plan
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {/* Billing Period Toggle */}
              {selectedPlan && (
                <div>
                  <label className="block text-sm font-medium mb-3">
                    Choose your billing period
                  </label>
                  <div className="flex rounded-lg bg-muted p-1">
                    <button
                      type="button"
                      onClick={() => setProductionData({ ...productionData, billingPeriod: 'monthly' })}
                      className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        productionData.billingPeriod === 'monthly'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      onClick={() => setProductionData({ ...productionData, billingPeriod: 'annual' })}
                      className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        productionData.billingPeriod === 'annual'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Annual
                      <Badge className="ml-2" variant="secondary">Save 15%</Badge>
                    </button>
                  </div>
                </div>
              )}

              {/* Plan Summary */}
              {selectedPlan && (
                <Card className="bg-primary/5 border-primary/20">
                  <CardContent className="pt-6">
                    <div className="flex items-baseline justify-between mb-2">
                      <h3 className="font-semibold">{selectedPlan.name} Plan</h3>
                      <div className="text-right">
                        <span className="text-2xl font-bold">${displayPrice}</span>
                        <span className="text-muted-foreground">/month</span>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {selectedPlan.bblRange} • Unlimited users • All features included
                    </p>
                    <p className="text-sm font-medium text-primary mt-2">
                      14-day free trial • No credit card required
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Attestation */}
              <div className="flex items-start space-x-2">
                <input
                  id="attestation"
                  type="checkbox"
                  checked={productionData.attestation}
                  onChange={(e) => setProductionData({ ...productionData, attestation: e.target.checked })}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <label htmlFor="attestation" className="text-sm">
                  I confirm this production level is accurate to the best of my knowledge. 
                  BrewCrush uses a fair, automatic check based on your packaged volume to suggest 
                  plan changes if needed.
                </label>
              </div>
            </div>

            <div className="space-y-3">
              <Button
                type="submit"
                className="w-full"
                disabled={loading || !productionData.bblTier || !productionData.attestation}
              >
                {loading ? 'Creating account...' : 'Start free trial'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setStep('account')}
              >
                Back
              </Button>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              By signing up, you agree to our{' '}
              <Link href="/terms" className="underline hover:text-foreground">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="underline hover:text-foreground">
                Privacy Policy
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}