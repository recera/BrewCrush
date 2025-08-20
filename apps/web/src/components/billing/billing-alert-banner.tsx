'use client'

import { AlertCircle, AlertTriangle, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useBillingStatus } from '@/hooks/use-billing-status'

export function BillingAlertBanner() {
  const [dismissed, setDismissed] = useState(false)
  const { 
    isReadOnly, 
    readOnlyReason, 
    isTrialExpired, 
    trialDaysRemaining, 
    isInTrial,
    loading 
  } = useBillingStatus()

  // Don't show anything while loading or if dismissed
  if (loading || dismissed) {
    return null
  }

  // Show read-only banner with highest priority
  if (isReadOnly) {
    return (
      <div className="bg-destructive/10 border-b border-destructive/20">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-destructive">Read-only mode: </span>
                <span className="text-destructive/90">
                  {getReadOnlyMessage(readOnlyReason)}
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Link href="/settings/billing">
                <Button size="sm" variant="destructive">
                  Fix Now
                </Button>
              </Link>
              <button
                onClick={() => setDismissed(true)}
                className="text-destructive/70 hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Show trial expired banner
  if (isTrialExpired) {
    return (
      <div className="bg-warning/10 border-b border-warning/20">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0" />
              <div className="text-sm">
                <span className="font-medium">Trial expired: </span>
                <span className="text-muted-foreground">
                  Your 14-day trial has ended. Upgrade now to continue using BrewCrush.
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Link href="/settings/billing">
                <Button size="sm" variant="default">
                  Upgrade Now
                </Button>
              </Link>
              <button
                onClick={() => setDismissed(true)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Show trial ending soon banner (3 days or less)
  if (isInTrial && trialDaysRemaining !== null && trialDaysRemaining <= 3) {
    return (
      <div className="bg-primary/5 border-b border-primary/20">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <AlertCircle className="h-5 w-5 text-primary flex-shrink-0" />
              <div className="text-sm">
                <span className="font-medium">Trial ending soon: </span>
                <span className="text-muted-foreground">
                  {trialDaysRemaining === 0 
                    ? 'Your trial ends today'
                    : `${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'} left in your trial`
                  }. Add a payment method to continue without interruption.
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Link href="/settings/billing">
                <Button size="sm" variant="default">
                  Add Payment Method
                </Button>
              </Link>
              <button
                onClick={() => setDismissed(true)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return null
}

function getReadOnlyMessage(reason: string | null): string {
  switch (reason) {
    case 'payment_failed':
      return 'Payment failed. Update your payment method to restore full access.'
    case 'trial_expired':
      return 'Trial expired. Upgrade to continue using BrewCrush.'
    case 'subscription_cancelled':
      return 'Subscription cancelled. Reactivate to restore access.'
    case 'manual_suspension':
      return 'Account suspended. Contact support for assistance.'
    default:
      return 'Limited access. Contact support for assistance.'
  }
}