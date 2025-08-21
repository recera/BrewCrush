'use client'

import Link from 'next/link'
import { Button } from '@brewcrush/ui'
import { Badge } from '@brewcrush/ui'
import { Card, CardContent } from '@brewcrush/ui'
import { 
  Beer, 
  BarChart3, 
  Package, 
  FileText, 
  Users, 
  Smartphone,
  CheckCircle,
  TrendingUp,
  Clock,
  Shield,
  ChevronRight,
  ArrowRight
} from 'lucide-react'

export default function LandingPage() {
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
                <Link href="#features" className="text-sm font-medium hover:text-primary">
                  Features
                </Link>
                <Link href="/pricing" className="text-sm font-medium hover:text-primary">
                  Pricing
                </Link>
                <Link href="#testimonials" className="text-sm font-medium hover:text-primary">
                  Testimonials
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

      {/* Hero Section */}
      <section className="container mx-auto px-6 pt-20 pb-32">
        <div className="max-w-4xl mx-auto text-center">
          <Badge className="mb-4" variant="secondary">
            Trusted by 100+ craft breweries
          </Badge>
          <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
            From Grain to Glass to Government
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            The easiest way for small breweries to plan, brew, package, track, and file. 
            Replace spreadsheets with a system that scales with you.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/auth/signup">
              <Button size="lg" className="w-full sm:w-auto">
                Start 14-Day Free Trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="#demo">
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                Watch Demo
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            No credit card required • Unlimited users • Cancel anytime
          </p>
        </div>
      </section>

      {/* Key Benefits */}
      <section className="container mx-auto px-6 pb-20">
        <div className="grid md:grid-cols-3 gap-8">
          <Card className="border-primary/20">
            <CardContent className="pt-6">
              <div className="rounded-lg bg-primary/10 w-12 h-12 flex items-center justify-center mb-4">
                <Clock className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Save 10+ Hours/Week</h3>
              <p className="text-sm text-muted-foreground">
                Automated BROP & excise filing, real-time inventory, and one-click reports
              </p>
            </CardContent>
          </Card>
          <Card className="border-primary/20">
            <CardContent className="pt-6">
              <div className="rounded-lg bg-primary/10 w-12 h-12 flex items-center justify-center mb-4">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Unlimited Users</h3>
              <p className="text-sm text-muted-foreground">
                No per-seat pricing. Your entire team can collaborate at no extra cost
              </p>
            </CardContent>
          </Card>
          <Card className="border-primary/20">
            <CardContent className="pt-6">
              <div className="rounded-lg bg-primary/10 w-12 h-12 flex items-center justify-center mb-4">
                <Smartphone className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Works Offline</h3>
              <p className="text-sm text-muted-foreground">
                Log readings and brew on the floor. Syncs automatically when reconnected
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="bg-secondary/30 py-20">
        <div className="container mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Everything You Need to Run Your Brewery</h2>
            <p className="text-lg text-muted-foreground">
              One integrated system from recipe to TTB filing
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Beer,
                title: "Production Management",
                features: [
                  "Recipe scaling & versioning",
                  "Batch scheduling & tracking",
                  "Tank management & CIP",
                  "Yeast generation tracking"
                ]
              },
              {
                icon: Package,
                title: "Inventory & Purchasing",
                features: [
                  "Real-time stock levels",
                  "Purchase orders & receiving",
                  "Lot tracking & FIFO",
                  "Supplier price history"
                ]
              },
              {
                icon: BarChart3,
                title: "Costing & Analytics",
                features: [
                  "Automatic COGS calculation",
                  "Batch cost analysis",
                  "Production efficiency",
                  "Recall drill capability"
                ]
              },
              {
                icon: FileText,
                title: "TTB Compliance",
                features: [
                  "Automated BROP generation",
                  "Excise tax worksheets",
                  "Transfers in bond",
                  "Contract brewing support"
                ]
              },
              {
                icon: TrendingUp,
                title: "Smart Packaging",
                features: [
                  "Blend management",
                  "Date/lot code templates",
                  "Label generation",
                  "Finished goods tracking"
                ]
              },
              {
                icon: Shield,
                title: "Security & Reliability",
                features: [
                  "Bank-level encryption",
                  "Immutable audit logs",
                  "Daily backups",
                  "99.9% uptime SLA"
                ]
              }
            ].map((feature, idx) => (
              <Card key={idx} className="hover:shadow-lg transition-shadow">
                <CardContent className="pt-6">
                  <feature.icon className="h-8 w-8 text-primary mb-4" />
                  <h3 className="font-semibold mb-3">{feature.title}</h3>
                  <ul className="space-y-2">
                    {feature.features.map((item, i) => (
                      <li key={i} className="flex items-start text-sm">
                        <CheckCircle className="h-4 w-4 text-primary mr-2 mt-0.5 flex-shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="py-20">
        <div className="container mx-auto px-6">
          <h2 className="text-3xl font-bold text-center mb-12">What Brewers Say</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                quote: "BrewCrush eliminated our spreadsheet chaos. BROP filing went from 4 hours to 15 minutes.",
                author: "Sarah Chen",
                brewery: "Hop Valley Brewing",
                size: "2,500 BBL/year"
              },
              {
                quote: "The offline mode is a game-changer. Our cellar team can log readings without WiFi issues.",
                author: "Mike Rodriguez",
                brewery: "Steel City Ales",
                size: "1,200 BBL/year"
              },
              {
                quote: "Finally, software that thinks like a brewer. The yeast tracking alone saves us hours.",
                author: "Emma Thompson",
                brewery: "Riverside Craft Co",
                size: "4,000 BBL/year"
              }
            ].map((testimonial, idx) => (
              <Card key={idx}>
                <CardContent className="pt-6">
                  <p className="italic mb-4">"{testimonial.quote}"</p>
                  <div>
                    <p className="font-semibold">{testimonial.author}</p>
                    <p className="text-sm text-muted-foreground">
                      {testimonial.brewery} • {testimonial.size}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-primary/5 py-20">
        <div className="container mx-auto px-6">
          <Card className="bg-primary text-primary-foreground">
            <CardContent className="py-12 text-center">
              <h2 className="text-3xl font-bold mb-4">
                Ready to Crush Your Brewery Management?
              </h2>
              <p className="text-lg mb-8 opacity-90">
                Join 100+ breweries saving 10+ hours per week
              </p>
              <Link href="/auth/signup">
                <Button size="lg" variant="secondary">
                  Start Your 14-Day Free Trial
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
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
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <Beer className="h-6 w-6 text-primary" />
                <span className="font-bold">BrewCrush</span>
              </div>
              <p className="text-sm text-muted-foreground">
                The modern brewery management system
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-3">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="#features" className="hover:text-primary">Features</Link></li>
                <li><Link href="/pricing" className="hover:text-primary">Pricing</Link></li>
                <li><Link href="/docs" className="hover:text-primary">Documentation</Link></li>
                <li><Link href="/api" className="hover:text-primary">API</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/about" className="hover:text-primary">About</Link></li>
                <li><Link href="/blog" className="hover:text-primary">Blog</Link></li>
                <li><Link href="/contact" className="hover:text-primary">Contact</Link></li>
                <li><Link href="/careers" className="hover:text-primary">Careers</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/privacy" className="hover:text-primary">Privacy Policy</Link></li>
                <li><Link href="/terms" className="hover:text-primary">Terms of Service</Link></li>
                <li><Link href="/security" className="hover:text-primary">Security</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t text-center text-sm text-muted-foreground">
            © 2025 BrewCrush. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}