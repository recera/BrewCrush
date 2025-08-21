'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui'
import { Button } from '@brewcrush/ui'
import { Badge } from '@brewcrush/ui'
import { Alert, AlertDescription } from '@brewcrush/ui'
import { Skeleton } from '@brewcrush/ui'
import { useToast } from '@brewcrush/ui'
import { createClient } from '@/lib/supabase/client'
import { redirectToCheckout } from '@/lib/stripe/client'
import { 
  CreditCard, 
  AlertCircle, 
  CheckCircle, 
  TrendingUp,
  Calendar,
  Package,
  ExternalLink,
  Loader2
} from 'lucide-react'
import { format } from 'date-fns'

interface BillingStatus {
  plan: string
  display_name: string
  billing_period: 'monthly' | 'annual'
  renewal_at: string | null
  trial_ends_at: string | null
  read_only_mode: boolean
  stripe_customer_id: string | null
  current_op: number | null
  plan_min_bbl: number
  plan_max_bbl: number | null
  has_suggestion: boolean
}

interface PlanSuggestion {
  id: string
  suggested_plan: {
    name: string
    display_name: string
    price_monthly: number
    price_annual_monthly: number
  }
  reason: string
  op_annualized_bbl: number
  effective_at_default: string
}

interface Invoice {
  id: string
  invoice_number: string
  amount_due: number
  status: string
  period_start: string
  period_end: string
  pdf_url: string | null
  created_at: string
}

export default function BillingSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null)
  const [suggestion, setSuggestion] = useState<PlanSuggestion | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [processingAction, setProcessingAction] = useState<string | null>(null)
  const [opHistory, setOpHistory] = useState<Array<{ date: string; op: number }>>([])
  
  const router = useRouter()
  const { toast } = useToast()
  const supabase = createClient()

  useEffect(() => {
    loadBillingData()
  }, [])

  async function loadBillingData() {
    try {
      // Get current user and workspace
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth/login')
        return
      }

      // Get workspace
      const { data: workspace } = await supabase
        .from('user_workspace_roles')
        .select('workspace_id')
        .eq('user_id', user.id)
        .single()

      if (!workspace) {
        router.push('/onboarding')
        return
      }

      setWorkspaceId(workspace.workspace_id)

      // Get billing status
      const { data: status } = await supabase
        .rpc('get_billing_status', { p_workspace_id: workspace.workspace_id })

      setBillingStatus(status)

      // Get active plan suggestion if any
      if (status?.has_suggestion) {
        const { data: suggestions } = await supabase
          .from('plan_change_suggestions')
          .select(`
            id,
            op_annualized_bbl,
            reason,
            effective_at_default,
            suggested_plan:billing_plans!plan_change_suggestions_suggested_plan_id_fkey(
              name,
              display_name,
              price_monthly,
              price_annual_monthly
            )
          `)
          .eq('workspace_id', workspace.workspace_id)
          .eq('status', 'suggested')
          .order('created_at', { ascending: false })
          .limit(1)

        if (suggestions && suggestions.length > 0) {
          setSuggestion(suggestions[0] as any)
        }
      }

      // Get recent invoices
      const { data: invoiceData } = await supabase
        .from('invoices')
        .select('*')
        .eq('workspace_id', workspace.workspace_id)
        .order('created_at', { ascending: false })
        .limit(10)

      setInvoices(invoiceData || [])

      // Get OP history for chart
      const { data: opData } = await supabase
        .from('observed_production_snapshots')
        .select('date, op_annualized_bbl')
        .eq('workspace_id', workspace.workspace_id)
        .order('date', { ascending: false })
        .limit(30)

      if (opData) {
        setOpHistory(opData.map(d => ({
          date: d.date,
          op: d.op_annualized_bbl
        })))
      }

    } catch (error) {
      console.error('Error loading billing data:', error)
      toast({
        title: 'Error',
        description: 'Failed to load billing information',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleUpgrade(planName: string, billingPeriod: 'monthly' | 'annual') {
    if (!workspaceId) return
    
    setProcessingAction('upgrade')
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planName,
          billingPeriod,
          workspaceId,
        }),
      })

      const data = await response.json()
      if (data.sessionId) {
        await redirectToCheckout(data.sessionId)
      } else {
        throw new Error(data.error || 'Failed to create checkout session')
      }
    } catch (error) {
      console.error('Upgrade error:', error)
      toast({
        title: 'Error',
        description: 'Failed to start checkout process',
        variant: 'destructive',
      })
    } finally {
      setProcessingAction(null)
    }
  }

  async function handleManageBilling() {
    if (!workspaceId) return
    
    setProcessingAction('portal')
    try {
      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })

      const data = await response.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        throw new Error(data.error || 'Failed to create portal session')
      }
    } catch (error) {
      console.error('Portal error:', error)
      toast({
        title: 'Error',
        description: 'Failed to open billing portal',
        variant: 'destructive',
      })
    } finally {
      setProcessingAction(null)
    }
  }

  async function handleAcceptSuggestion(when: 'now' | 'renewal') {
    if (!suggestion) return
    
    setProcessingAction(`accept-${when}`)
    try {
      const { error } = await supabase
        .rpc('accept_plan_suggestion', {
          p_suggestion_id: suggestion.id,
          p_when: when
        })

      if (error) throw error

      toast({
        title: 'Plan change scheduled',
        description: when === 'now' 
          ? 'Your plan will be updated immediately'
          : 'Your plan will change at the next renewal',
      })

      // Refresh data
      await loadBillingData()
    } catch (error) {
      console.error('Error accepting suggestion:', error)
      toast({
        title: 'Error',
        description: 'Failed to accept plan change',
        variant: 'destructive',
      })
    } finally {
      setProcessingAction(null)
    }
  }

  async function handleDismissSuggestion() {
    if (!suggestion) return
    
    setProcessingAction('dismiss')
    try {
      const { error } = await supabase
        .rpc('dismiss_plan_suggestion', {
          p_suggestion_id: suggestion.id
        })

      if (error) throw error

      toast({
        title: 'Suggestion dismissed',
        description: 'We\'ll check again next month',
      })

      setSuggestion(null)
    } catch (error) {
      console.error('Error dismissing suggestion:', error)
      toast({
        title: 'Error',
        description: 'Failed to dismiss suggestion',
        variant: 'destructive',
      })
    } finally {
      setProcessingAction(null)
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto py-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  const isInTrial = billingStatus?.trial_ends_at && new Date(billingStatus.trial_ends_at) > new Date()
  const trialDaysLeft = isInTrial 
    ? Math.ceil((new Date(billingStatus.trial_ends_at!).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 0

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Billing & Subscription</h1>
        <p className="text-muted-foreground">
          Manage your subscription, view invoices, and track production-based pricing
        </p>
      </div>

      {/* Read-only mode warning */}
      {billingStatus?.read_only_mode && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Your workspace is in read-only mode due to payment issues. 
            Please update your payment method to restore full access.
          </AlertDescription>
        </Alert>
      )}

      {/* Trial banner */}
      {isInTrial && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Your trial ends in {trialDaysLeft} days. Upgrade now to ensure uninterrupted access.
          </AlertDescription>
        </Alert>
      )}

      {/* Plan suggestion banner */}
      {suggestion && (
        <Card className="border-primary">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                <CardTitle>Plan Change Suggestion</CardTitle>
              </div>
              <Badge variant="secondary">Recommended</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              You're tracking ~{Math.round(suggestion.op_annualized_bbl)} BBL/yr, 
              above the {billingStatus?.display_name} band. 
              We recommend upgrading to {suggestion.suggested_plan.display_name} 
              (${(suggestion.suggested_plan.price_monthly / 100).toFixed(0)}/mo).
            </p>
            <div className="flex gap-2">
              <Button 
                onClick={() => handleAcceptSuggestion('now')}
                disabled={processingAction !== null}
              >
                {processingAction === 'accept-now' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Accept Now
              </Button>
              <Button 
                variant="outline"
                onClick={() => handleAcceptSuggestion('renewal')}
                disabled={processingAction !== null}
              >
                {processingAction === 'accept-renewal' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Change at Renewal
              </Button>
              <Button 
                variant="ghost"
                onClick={handleDismissSuggestion}
                disabled={processingAction !== null}
              >
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Current Plan */}
        <Card>
          <CardHeader>
            <CardTitle>Current Plan</CardTitle>
            <CardDescription>Your subscription details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{billingStatus?.display_name}</p>
                <p className="text-sm text-muted-foreground">
                  {billingStatus?.billing_period === 'annual' ? 'Annual billing' : 'Monthly billing'}
                </p>
              </div>
              <Badge variant={isInTrial ? 'secondary' : 'default'}>
                {isInTrial ? 'Trial' : 'Active'}
              </Badge>
            </div>

            {billingStatus?.renewal_at && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Next renewal</p>
                <p className="text-sm text-muted-foreground">
                  {format(new Date(billingStatus.renewal_at), 'MMM d, yyyy')}
                </p>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-sm font-medium">Production band</p>
              <p className="text-sm text-muted-foreground">
                {billingStatus?.plan_min_bbl} - {billingStatus?.plan_max_bbl || '∞'} BBL/year
              </p>
            </div>

            {billingStatus?.stripe_customer_id && (
              <Button 
                className="w-full" 
                onClick={handleManageBilling}
                disabled={processingAction !== null}
              >
                {processingAction === 'portal' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <CreditCard className="mr-2 h-4 w-4" />
                Manage Billing
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Observed Production */}
        <Card>
          <CardHeader>
            <CardTitle>Observed Production</CardTitle>
            <CardDescription>Your annualized production based on last 90 days</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-3xl font-bold">
                {billingStatus?.current_op ? Math.round(billingStatus.current_op) : 0}
              </p>
              <p className="text-sm text-muted-foreground">BBL/year</p>
            </div>

            {opHistory.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">30-day trend</p>
                <div className="flex items-end h-16 gap-1">
                  {opHistory.slice(0, 30).reverse().map((point, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-primary opacity-50 hover:opacity-100 transition-opacity"
                      style={{
                        height: `${(point.op / Math.max(...opHistory.map(p => p.op))) * 100}%`,
                        minHeight: '2px'
                      }}
                      title={`${point.date}: ${Math.round(point.op)} BBL/yr`}
                    />
                  ))}
                </div>
              </div>
            )}

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                We annualize your last 90 days of packaging to estimate annual BBL. 
                There's a ±10% grace band to avoid seasonal false positives.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>

      {/* Available Plans */}
      <Card>
        <CardHeader>
          <CardTitle>Available Plans</CardTitle>
          <CardDescription>All plans include unlimited users and the same features</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { name: 'starter', display: 'Starter', bbl: '≤ 1,000', monthly: 40, annual: 34 },
              { name: 'growth', display: 'Growth', bbl: '1,001-3,500', monthly: 85, annual: 72 },
              { name: 'pro', display: 'Pro', bbl: '3,501-10,000', monthly: 200, annual: 170 },
            ].map((plan) => (
              <div 
                key={plan.name}
                className={`p-4 rounded-lg border ${
                  billingStatus?.plan === plan.name ? 'border-primary bg-primary/5' : ''
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{plan.display}</h3>
                    {billingStatus?.plan === plan.name && (
                      <Badge variant="default">Current</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{plan.bbl} BBL/year</p>
                  <div className="space-y-1">
                    <p className="text-2xl font-bold">${plan.monthly}/mo</p>
                    <p className="text-sm text-muted-foreground">
                      or ${plan.annual}/mo billed annually
                    </p>
                  </div>
                  {billingStatus?.plan !== plan.name && (
                    <div className="pt-2 space-y-2">
                      <Button 
                        size="sm" 
                        className="w-full"
                        onClick={() => handleUpgrade(plan.name, 'monthly')}
                        disabled={processingAction !== null}
                      >
                        Upgrade Monthly
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="w-full"
                        onClick={() => handleUpgrade(plan.name, 'annual')}
                        disabled={processingAction !== null}
                      >
                        Upgrade Annual (Save 15%)
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Setup Packages */}
      <Card>
        <CardHeader>
          <CardTitle>Setup & Migration Packages</CardTitle>
          <CardDescription>One-time services to help you get started</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { 
                key: 'basic',
                name: 'Basic Setup', 
                price: 299, 
                features: ['CSV mapping session', '60-min screen share', 'Import validation'] 
              },
              { 
                key: 'whiteGlove',
                name: 'White-glove Setup', 
                price: 899, 
                features: ['Legacy sheet conversion', '3 recipes recreated', 'Brew dry-run', 'POS ingest setup'] 
              },
              { 
                key: 'legacySwitch',
                name: 'Legacy Switch', 
                price: 1499, 
                features: ['Everything in White-glove', 'BROP/Excise rehearsal', 'Filing week support'] 
              },
            ].map((pkg) => (
              <div key={pkg.key} className="p-4 rounded-lg border space-y-3">
                <div>
                  <h3 className="font-semibold">{pkg.name}</h3>
                  <p className="text-2xl font-bold mt-1">${pkg.price}</p>
                </div>
                <ul className="space-y-1">
                  {pkg.features.map((feature, i) => (
                    <li key={i} className="flex items-start text-sm">
                      <CheckCircle className="h-4 w-4 text-primary mr-2 mt-0.5 flex-shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="w-full"
                  onClick={() => handleUpgrade('', '', pkg.key)}
                  disabled={processingAction !== null}
                >
                  <Package className="mr-2 h-4 w-4" />
                  Purchase
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Invoices */}
      {invoices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Invoices</CardTitle>
            <CardDescription>Your billing history</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {invoices.map((invoice) => (
                <div 
                  key={invoice.id}
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div>
                    <p className="font-medium">
                      {invoice.invoice_number || `Invoice ${invoice.id.slice(0, 8)}`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(invoice.period_start), 'MMM d')} - {format(new Date(invoice.period_end), 'MMM d, yyyy')}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-medium">${(invoice.amount_due / 100).toFixed(2)}</p>
                      <Badge variant={invoice.status === 'succeeded' ? 'default' : 'secondary'}>
                        {invoice.status}
                      </Badge>
                    </div>
                    {invoice.pdf_url && (
                      <Button size="icon" variant="ghost" asChild>
                        <a href={invoice.pdf_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Helper function for upgrade with setup package
function handleUpgrade(planName: string, billingPeriod: string, setupPackage?: string) {
  // Implementation would be similar but pass setupPackage parameter
}