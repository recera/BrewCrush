'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@brewcrush/ui'
import { 
  LayoutDashboard, 
  Package, 
  FlaskConical, 
  FileText, 
  Settings,
  Users,
  LogOut,
  Menu,
  X,
  ShoppingCart,
  ClipboardList,
  BarChart3
} from 'lucide-react'

interface DashboardShellProps {
  user: any
  workspace: any
  role: string
  children: React.ReactNode
}

export function DashboardShell({ user, workspace, role, children }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  // Navigation items based on role
  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['admin', 'brewer', 'inventory', 'accounting', 'contract_viewer'] },
    { name: 'Production', href: '/production', icon: FlaskConical, roles: ['admin', 'brewer'] },
    { name: 'Inventory', href: '/inventory', icon: Package, roles: ['admin', 'inventory', 'brewer'] },
    { name: 'Purchasing', href: '/purchasing', icon: ShoppingCart, roles: ['admin', 'inventory', 'accounting'] },
    { name: 'Recipes', href: '/recipes', icon: ClipboardList, roles: ['admin', 'brewer'] },
    { name: 'Reports', href: '/reports', icon: BarChart3, roles: ['admin', 'accounting', 'contract_viewer'] },
    { name: 'Compliance', href: '/compliance', icon: FileText, roles: ['admin', 'accounting'] },
    { name: 'Settings', href: '/settings', icon: Settings, roles: ['admin'] },
  ].filter(item => item.roles.includes(role))

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 transform bg-card transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center justify-between px-4 border-b">
            <Link href="/dashboard" className="flex items-center space-x-2">
              <FlaskConical className="h-8 w-8 text-primary" />
              <span className="text-xl font-bold">BrewCrush</span>
            </Link>
            <button
              className="lg:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Workspace info */}
          <div className="px-4 py-3 border-b">
            <p className="text-sm font-medium">{workspace.name}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {workspace.plan} • {role.replace('_', ' ')}
            </p>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 px-2 py-4">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className="group flex items-center px-2 py-2 text-sm font-medium rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <item.icon className="mr-3 h-5 w-5 flex-shrink-0" />
                {item.name}
              </Link>
            ))}
          </nav>

          {/* User menu */}
          <div className="border-t p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-medium">
                    {user?.full_name?.charAt(0) || user?.email?.charAt(0) || 'U'}
                  </span>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium">{user?.full_name || 'User'}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="text-muted-foreground hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex h-16 items-center gap-x-4 border-b bg-background px-4 sm:gap-x-6 sm:px-6 lg:px-8">
          <button
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-6 w-6" />
          </button>

          <div className="flex flex-1 gap-x-4 self-stretch lg:gap-x-6">
            <div className="flex flex-1 items-center">
              {/* Breadcrumbs or page title can go here */}
            </div>
            <div className="flex items-center gap-x-4 lg:gap-x-6">
              {/* Notifications, etc. */}
              {role === 'admin' && (
                <Link href="/settings/team">
                  <Button variant="outline" size="sm">
                    <Users className="h-4 w-4 mr-2" />
                    Invite Team
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Page content */}
        <main className="p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}