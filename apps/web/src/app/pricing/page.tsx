'use client'

import Link from 'next/link'
import { Button } from '@brewcrush/ui'
import { Badge } from '@brewcrush/ui'
import { Card, CardContent, CardHeader, CardTitle } from '@brewcrush/ui'
import { 
  Beer, 
  CheckCircle,
  HelpCircle,
  Package,
  ChevronDown,
  ChevronUp,
  TrendingUp
} from 'lucide-react'
import { useState } from 'react'

export default function PricingPage() {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-secondary/20">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-8">
              <Link href="/" className="flex items-center space-x-2">
                <Beer className="h-8 w-8 text-primary" />
                <span className="text-2xl font-bold">BrewCrush</span>
              </Link>
              <div className="hidden md:flex space-x-6">
                <Link href="/" className="text-sm font-medium hover:text-primary">
                  Home
                </Link>
                <Link href="/#features" className="text-sm font-medium hover:text-primary">
                  Features
                </Link>
                <Link href="/pricing" className="text-sm font-medium text-primary">
                  Pricing
                </Link>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <Link href="/auth/login">
                <Button variant="ghost">Sign In</Button>
              </Link>
              <Link href="/auth/signup">
                <Button>Start Free Trial</Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Pricing Hero */}
      <section className="container mx-auto px-6 pt-20 pb-12">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Simple, Fair Pricing for Breweries
          </h1>
          <p className="text-xl text-muted-foreground mb-8">
            Priced by your annual production. All plans include unlimited users and the same powerful features.
          </p>
          
          {/* Billing Toggle */}
          <div className="inline-flex items-center gap-4 p-1 bg-secondary rounded-lg">
            <button
              onClick={() => setBillingPeriod('monthly')}
              className={`px-4 py-2 rounded-md transition-colors ${
                billingPeriod === 'monthly' 
                  ? 'bg-white shadow-sm text-primary font-medium' 
                  : 'text-muted-foreground'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingPeriod('annual')}
              className={`px-4 py-2 rounded-md transition-colors ${
                billingPeriod === 'annual' 
                  ? 'bg-white shadow-sm text-primary font-medium' 
                  : 'text-muted-foreground'
              }`}
            >
              Annual
              <Badge className="ml-2" variant="secondary">Save 15%</Badge>
            </button>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="container mx-auto px-6 pb-20">
        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {[
            {
              name: 'Starter',
              price: billingPeriod === 'annual' ? 34 : 40,
              bbl: '≤ 1,000',
              description: 'Perfect for nanobreweries and new taprooms',
              features: [
                'Up to 1,000 BBL/year production',
                'Unlimited users',
                'All core features',
                'Mobile & offline mode',
                'TTB compliance (BROP & Excise)',
                'Email support (24-48h)',
                'Data export anytime'
              ],
              popular: false
            },
            {
              name: 'Growth',
              price: billingPeriod === 'annual' ? 72 : 85,
              bbl: '1,001-3,500',
              description: 'For established microbreweries',
              features: [
                '1,001 to 3,500 BBL/year production',
                'Everything in Starter',
                'Priority email support (12-24h)',
                'Advanced reporting',
                'API access',
                'Custom integrations support',
                'Quarterly business reviews'
              ],
              popular: true
            },
            {
              name: 'Pro',
              price: billingPeriod === 'annual' ? 170 : 200,
              bbl: '3,501-10,000',
              description: 'For larger craft breweries',
              features: [
                '3,501 to 10,000 BBL/year',
                'Everything in Growth',
                'Priority support (4h)',
                'Dedicated onboarding',
                'Custom training sessions',
                'Early access to new features',
                'Annual strategy consultation'
              ],
              popular: false
            }
          ].map((plan) => (
            <Card 
              key={plan.name}
              className={`relative ${plan.popular ? 'border-primary shadow-xl scale-105' : ''}`}
            >
              {plan.popular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                  Most Popular
                </Badge>
              )}
              <CardHeader className="pb-8">
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <p className="text-sm text-muted-foreground mt-2">{plan.bbl} BBL/year</p>
                <div className="mt-4">
                  <span className="text-4xl font-bold">${plan.price}</span>
                  <span className="text-muted-foreground">/month</span>
                  {billingPeriod === 'annual' && (
                    <p className="text-sm text-primary mt-1">
                      Billed annually (${plan.price * 12}/year)
                    </p>
                  )}
                </div>
                <p className="text-sm mt-4">{plan.description}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-3">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start text-sm">
                      <CheckCircle className="h-4 w-4 text-primary mr-2 mt-0.5 flex-shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/auth/signup" className="block">
                  <Button 
                    className="w-full" 
                    variant={plan.popular ? 'default' : 'outline'}
                  >
                    Start 14-Day Free Trial
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Enterprise */}
        <Card className="max-w-4xl mx-auto mt-12">
          <CardContent className="py-8">
            <div className="grid md:grid-cols-2 gap-8 items-center">
              <div>
                <h3 className="text-2xl font-bold mb-2">Enterprise</h3>
                <p className="text-muted-foreground mb-4">
                  For breweries producing over 10,000 BBL/year or with special requirements
                </p>
                <ul className="space-y-2 mb-6">
                  <li className="flex items-center text-sm">
                    <CheckCircle className="h-4 w-4 text-primary mr-2" />
                    Custom pricing based on volume
                  </li>
                  <li className="flex items-center text-sm">
                    <CheckCircle className="h-4 w-4 text-primary mr-2" />
                    Dedicated account manager
                  </li>
                  <li className="flex items-center text-sm">
                    <CheckCircle className="h-4 w-4 text-primary mr-2" />
                    Custom integrations & features
                  </li>
                  <li className="flex items-center text-sm">
                    <CheckCircle className="h-4 w-4 text-primary mr-2" />
                    On-premise deployment option
                  </li>
                </ul>
              </div>
              <div className="text-center md:text-right">
                <Link href="/contact">
                  <Button size="lg">Contact Sales</Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* How OP Works */}
      <section className="bg-secondary/30 py-20">
        <div className="container mx-auto px-6">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-12">
              Fair, Automatic Production-Based Pricing
            </h2>
            
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  How Observed Production (OP) Works
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="font-semibold mb-2">We calculate your production automatically</h4>
                  <p className="text-sm text-muted-foreground">
                    We annualize your last 90 days of packaging to estimate annual BBL. 
                    This happens weekly in the background—no paperwork needed.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Grace band prevents false positives</h4>
                  <p className="text-sm text-muted-foreground">
                    There's a ±10% grace band around tier limits. We also require two consecutive 
                    months above the threshold before suggesting a change, avoiding seasonal spikes.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">You control when changes happen</h4>
                  <p className="text-sm text-muted-foreground">
                    If your production exceeds your tier, we'll suggest an upgrade with options: 
                    accept immediately or wait until your next renewal. No surprise bills.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Downgrades available too</h4>
                  <p className="text-sm text-muted-foreground">
                    If your production decreases for 3+ months, we'll offer a downgrade 
                    to save you money. Fair works both ways.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Setup Packages */}
      <section className="py-20">
        <div className="container mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Setup & Migration Services</h2>
            <p className="text-lg text-muted-foreground">
              Optional one-time packages to get you up and running faster
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              {
                icon: Package,
                name: 'Basic Setup',
                price: 299,
                features: [
                  'CSV data mapping session',
                  '60-minute screen share',
                  'Import validation',
                  'Basic training'
                ]
              },
              {
                icon: Package,
                name: 'White-glove Setup',
                price: 899,
                features: [
                  'Everything in Basic',
                  'Legacy spreadsheet conversion',
                  '3 recipes recreated',
                  'Test brew dry-run',
                  'POS integration setup'
                ]
              },
              {
                icon: Package,
                name: 'Legacy Switch',
                price: 1499,
                features: [
                  'Everything in White-glove',
                  'BROP/Excise rehearsal',
                  'Filing week support',
                  '3 months of priority support',
                  'Custom report creation'
                ]
              }
            ].map((pkg) => (
              <Card key={pkg.name}>
                <CardHeader>
                  <pkg.icon className="h-8 w-8 text-primary mb-2" />
                  <CardTitle>{pkg.name}</CardTitle>
                  <p className="text-2xl font-bold">${pkg.price}</p>
                  <p className="text-sm text-muted-foreground">One-time fee</p>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {pkg.features.map((feature, i) => (
                      <li key={i} className="flex items-start text-sm">
                        <CheckCircle className="h-4 w-4 text-primary mr-2 mt-0.5 flex-shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/auth/signup" className="block mt-6">
                    <Button variant="outline" className="w-full">
                      Add to Plan
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-secondary/30 py-20">
        <div className="container mx-auto px-6">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-12">
              Frequently Asked Questions
            </h2>
            
            <div className="space-y-4">
              {[
                {
                  q: 'Do I need a credit card to start the trial?',
                  a: 'No! Start your 14-day trial without a credit card. We only ask for payment when you\'re ready to continue after the trial.'
                },
                {
                  q: 'What happens if I go over my production tier?',
                  a: 'We\'ll notify you and suggest an upgrade, but you control when it happens. By default, changes occur at your next renewal to avoid surprise bills. You can also choose to upgrade immediately if you prefer.'
                },
                {
                  q: 'Can I change plans anytime?',
                  a: 'Yes! You can upgrade or downgrade anytime. Upgrades take effect immediately (prorated), while downgrades apply at your next renewal.'
                },
                {
                  q: 'What\'s included in "unlimited users"?',
                  a: 'Every person in your brewery can have their own login—brewers, cellar staff, packaging team, management, accounting—at no extra cost. No per-seat pricing ever.'
                },
                {
                  q: 'Is there a long-term contract?',
                  a: 'No contracts! BrewCrush is month-to-month (or annual if you choose). Cancel anytime with no penalties. Your data is always exportable.'
                },
                {
                  q: 'Do you offer discounts for startups?',
                  a: 'The Starter plan is already optimized for small breweries. If you\'re pre-revenue or have special circumstances, contact us to discuss options.'
                },
                {
                  q: 'What about data security?',
                  a: 'We use bank-level encryption, daily backups, and maintain SOC 2 Type 1 compliance readiness. Your data is always yours and exportable anytime.'
                },
                {
                  q: 'Can I integrate with my existing systems?',
                  a: 'Yes! We offer CSV import/export, QuickBooks/Xero integration, and API access (Growth plan and above). Our team can help with custom integrations.'
                }
              ].map((item, idx) => (
                <Card key={idx} className="cursor-pointer" onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}>
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">{item.q}</h3>
                      {expandedFaq === idx ? (
                        <ChevronUp className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                  </CardHeader>
                  {expandedFaq === idx && (
                    <CardContent className="pt-0">
                      <p className="text-muted-foreground">{item.a}</p>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="container mx-auto px-6">
          <Card className="bg-primary text-primary-foreground">
            <CardContent className="py-12 text-center">
              <h2 className="text-3xl font-bold mb-4">
                Ready to modernize your brewery?
              </h2>
              <p className="text-lg mb-8 opacity-90">
                Join 100+ breweries already using BrewCrush
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/auth/signup">
                  <Button size="lg" variant="secondary">
                    Start 14-Day Free Trial
                  </Button>
                </Link>
                <Link href="/contact">
                  <Button size="lg" variant="outline" className="bg-transparent text-primary-foreground border-primary-foreground hover:bg-primary-foreground/10">
                    Schedule a Demo
                  </Button>
                </Link>
              </div>
              <p className="mt-4 text-sm opacity-75">
                No credit card required • Set up in 5 minutes
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-secondary/50 py-12">
        <div className="container mx-auto px-6">
          <div className="text-center">
            <Link href="/" className="inline-flex items-center space-x-2 mb-4">
              <Beer className="h-6 w-6 text-primary" />
              <span className="font-bold">BrewCrush</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              © 2025 BrewCrush. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}