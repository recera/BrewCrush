'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@brewcrush/ui'

export default function OnboardingPage() {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [workspaceName, setWorkspaceName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [billingPlan, setBillingPlan] = useState('')
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  useEffect(() => {
    // Pre-fill workspace name from signup if available
    const suggestedName = searchParams.get('workspace')
    if (suggestedName) {
      setWorkspaceName(suggestedName)
    }

    // Get billing info from signup
    const plan = searchParams.get('plan')
    const billing = searchParams.get('billing')
    if (plan) setBillingPlan(plan)
    if (billing) setBillingPeriod(billing as 'monthly' | 'annual')

    // Check if user has an invite code
    const code = searchParams.get('invite')
    if (code) {
      setMode('join')
      setInviteCode(code)
    }
  }, [searchParams])

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      // Call RPC function to create workspace with billing setup
      const { data, error } = await supabase.rpc('create_workspace_with_billing', {
        workspace_name: workspaceName,
        plan_tier: billingPlan || 'starter',
        billing_period: billingPeriod,
      })

      if (error) throw error

      // Redirect to dashboard
      router.push('/dashboard')
    } catch (error: any) {
      setError(error.message || 'Failed to create workspace')
    } finally {
      setLoading(false)
    }
  }

  const handleJoinWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      // Call RPC function to join workspace with invite code
      const { data, error } = await supabase.rpc('join_workspace_with_invite', {
        invite_code: inviteCode,
      })

      if (error) throw error

      // Redirect to dashboard
      router.push('/dashboard')
    } catch (error: any) {
      setError(error.message || 'Failed to join workspace')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-bold tracking-tight">
            Welcome to BrewCrush!
          </h2>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Let's get your brewery set up
          </p>
        </div>

        <div className="mt-8">
          {/* Mode selector */}
          <div className="flex rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => setMode('create')}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === 'create'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Create Workspace
            </button>
            <button
              type="button"
              onClick={() => setMode('join')}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === 'join'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Join Workspace
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-md bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {mode === 'create' ? (
            <form onSubmit={handleCreateWorkspace} className="mt-6 space-y-4">
              <div>
                <label htmlFor="workspaceName" className="block text-sm font-medium">
                  Workspace Name
                </label>
                <input
                  id="workspaceName"
                  name="workspaceName"
                  type="text"
                  required
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Your Brewery Name"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  This will be your brewery's workspace in BrewCrush
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loading}
              >
                {loading ? 'Creating workspace...' : 'Create Workspace'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleJoinWorkspace} className="mt-6 space-y-4">
              <div>
                <label htmlFor="inviteCode" className="block text-sm font-medium">
                  Invite Code
                </label>
                <input
                  id="inviteCode"
                  name="inviteCode"
                  type="text"
                  required
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Enter your invite code"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Ask your workspace admin for an invite code
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loading}
              >
                {loading ? 'Joining workspace...' : 'Join Workspace'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}