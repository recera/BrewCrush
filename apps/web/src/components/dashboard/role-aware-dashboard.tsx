'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { 
  Package, 
  FlaskConical, 
  AlertCircle, 
  TrendingUp,
  Calendar,
  Users,
  DollarSign,
  FileText,
  CheckCircle,
  Clock,
  Beer
} from 'lucide-react'

interface RoleAwareDashboardProps {
  role: string
  workspace: any
}

export function RoleAwareDashboard({ role, workspace }: RoleAwareDashboardProps) {
  const [stats, setStats] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    loadDashboardData()
  }, [role])

  const loadDashboardData = async () => {
    setLoading(true)
    try {
      // Load data based on role
      // For Phase 1, we'll show placeholder data
      // In later phases, this will connect to real data
      
      if (role === 'admin' || role === 'accounting') {
        // Load financial and compliance data
        setStats({
          inventoryValue: '$45,230',
          monthlyProduction: '320 BBL',
          openPOs: 5,
          complianceStatus: 'Current',
        })
      } else if (role === 'brewer') {
        // Load production data
        setStats({
          activeBatches: 8,
          tanksInUse: '12/15',
          upcomingBrews: 3,
          fermReadingsDue: 4,
        })
      } else if (role === 'inventory') {
        // Load inventory data
        setStats({
          lowStockItems: 7,
          pendingReceiving: 3,
          openPOs: 5,
          cycleCountDue: 'Tomorrow',
        })
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Admin/Owner Dashboard
  if (role === 'admin') {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back to {workspace.name}</p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <StatCard
            title="Inventory Value"
            value={stats.inventoryValue || '—'}
            icon={Package}
            trend="+12.5%"
            trendUp={true}
          />
          <StatCard
            title="Monthly Production"
            value={stats.monthlyProduction || '—'}
            icon={FlaskConical}
            trend="+8.2%"
            trendUp={true}
          />
          <StatCard
            title="Open POs"
            value={stats.openPOs || 0}
            icon={FileText}
          />
          <StatCard
            title="Compliance"
            value={stats.complianceStatus || '—'}
            icon={CheckCircle}
            status="success"
          />
        </div>

        {/* Quick Actions */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <QuickActionCard
            title="Production Overview"
            description="8 active batches, 3 packaging runs scheduled"
            icon={FlaskConical}
            href="/production"
          />
          <QuickActionCard
            title="Low Stock Alert"
            description="7 items below reorder level"
            icon={AlertCircle}
            href="/inventory"
            variant="warning"
          />
          <QuickActionCard
            title="TTB Filing Due"
            description="BROP due in 5 days"
            icon={FileText}
            href="/compliance"
            variant="urgent"
          />
        </div>
      </div>
    )
  }

  // Brewer Dashboard
  if (role === 'brewer') {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Brewer Dashboard</h1>
          <p className="text-muted-foreground">Today's production overview</p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <StatCard
            title="Active Batches"
            value={stats.activeBatches || 0}
            icon={Beer}
          />
          <StatCard
            title="Tank Usage"
            value={stats.tanksInUse || '—'}
            icon={FlaskConical}
          />
          <StatCard
            title="Upcoming Brews"
            value={stats.upcomingBrews || 0}
            icon={Calendar}
          />
          <StatCard
            title="Readings Due"
            value={stats.fermReadingsDue || 0}
            icon={Clock}
            status={stats.fermReadingsDue > 0 ? 'warning' : 'default'}
          />
        </div>

        {/* Today's Tasks */}
        <div className="bg-card rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Today's Tasks</h2>
          <div className="space-y-3">
            <TaskItem
              title="Take fermentation readings"
              description="IPA-042, Stout-038"
              time="Due by 2:00 PM"
            />
            <TaskItem
              title="Start brew: Summer Wheat"
              description="Tank F3 ready, ingredients staged"
              time="Scheduled 10:00 AM"
            />
            <TaskItem
              title="Transfer to bright"
              description="Lager-041 ready for transfer"
              time="After CIP cycle"
            />
          </div>
        </div>
      </div>
    )
  }

  // Inventory Dashboard
  if (role === 'inventory') {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Inventory Dashboard</h1>
          <p className="text-muted-foreground">Stock levels and purchasing</p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <StatCard
            title="Low Stock Items"
            value={stats.lowStockItems || 0}
            icon={AlertCircle}
            status={stats.lowStockItems > 5 ? 'warning' : 'default'}
          />
          <StatCard
            title="Pending Receiving"
            value={stats.pendingReceiving || 0}
            icon={Package}
          />
          <StatCard
            title="Open POs"
            value={stats.openPOs || 0}
            icon={FileText}
          />
          <StatCard
            title="Cycle Count"
            value={stats.cycleCountDue || '—'}
            icon={CheckCircle}
          />
        </div>

        {/* Inventory Alerts */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="bg-card rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Low Stock Alert</h2>
            <div className="space-y-2">
              <LowStockItem name="Cascade Hops" current="2 lbs" reorder="10 lbs" />
              <LowStockItem name="2-Row Malt" current="50 lbs" reorder="500 lbs" />
              <LowStockItem name="16oz Cans" current="240" reorder="2,400" />
            </div>
          </div>
          <div className="bg-card rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Expected Deliveries</h2>
            <div className="space-y-2">
              <DeliveryItem vendor="Hop Supplier Co" date="Today" items="3 items" />
              <DeliveryItem vendor="Malt Direct" date="Tomorrow" items="5 items" />
              <DeliveryItem vendor="Can Supply Inc" date="Wed" items="1 item" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Accounting/Compliance Dashboard
  if (role === 'accounting') {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Compliance & Accounting</h1>
          <p className="text-muted-foreground">Financial overview and compliance status</p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <StatCard
            title="Inventory Value"
            value={stats.inventoryValue || '—'}
            icon={DollarSign}
          />
          <StatCard
            title="Open Invoices"
            value="$12,450"
            icon={FileText}
          />
          <StatCard
            title="BROP Status"
            value="Due in 5 days"
            icon={Clock}
            status="warning"
          />
          <StatCard
            title="Excise Tax"
            value="Current"
            icon={CheckCircle}
            status="success"
          />
        </div>

        {/* Compliance Tasks */}
        <div className="bg-card rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Compliance Tasks</h2>
          <div className="space-y-3">
            <ComplianceTask
              title="Monthly BROP (5130.9)"
              status="pending"
              dueDate="Dec 15, 2025"
              description="November production report"
            />
            <ComplianceTask
              title="Quarterly Excise Return"
              status="completed"
              dueDate="Oct 14, 2025"
              description="Q3 2025 - Filed"
            />
            <ComplianceTask
              title="State Report"
              status="pending"
              dueDate="Dec 20, 2025"
              description="Monthly state excise report"
            />
          </div>
        </div>
      </div>
    )
  }

  // Contract Viewer Dashboard (limited view)
  if (role === 'contract_viewer') {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Contract Overview</h1>
          <p className="text-muted-foreground">Your production at {workspace.name}</p>
        </div>

        <div className="bg-card rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Your Batches</h2>
          <p className="text-muted-foreground">
            You have limited access to view your contract brewing information.
            Contact the brewery administrator for additional access.
          </p>
        </div>
      </div>
    )
  }

  return null
}

// Component helpers
function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  trend, 
  trendUp, 
  status = 'default' 
}: any) {
  const statusColors = {
    default: '',
    success: 'text-green-600',
    warning: 'text-yellow-600',
    error: 'text-red-600',
  }

  return (
    <div className="bg-card rounded-lg p-6">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-muted-foreground">{title}</p>
        <Icon className={`h-5 w-5 text-muted-foreground ${statusColors[status]}`} />
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {trend && (
        <p className={`text-sm mt-1 ${trendUp ? 'text-green-600' : 'text-red-600'}`}>
          {trend} from last month
        </p>
      )}
    </div>
  )
}

function QuickActionCard({ title, description, icon: Icon, href, variant = 'default' }: any) {
  const variants = {
    default: 'bg-card',
    warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
    urgent: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  }

  return (
    <a href={href} className={`block rounded-lg p-6 border hover:shadow-md transition-shadow ${variants[variant]}`}>
      <div className="flex items-start space-x-3">
        <Icon className="h-6 w-6 text-muted-foreground flex-shrink-0" />
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
      </div>
    </a>
  )
}

function TaskItem({ title, description, time }: any) {
  return (
    <div className="flex items-start space-x-3 p-3 rounded-lg hover:bg-accent transition-colors">
      <CheckCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
      <div className="flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
        <p className="text-xs text-muted-foreground mt-1">{time}</p>
      </div>
    </div>
  )
}

function LowStockItem({ name, current, reorder }: any) {
  return (
    <div className="flex justify-between items-center p-2">
      <span className="font-medium">{name}</span>
      <div className="text-right">
        <p className="text-sm text-red-600">{current}</p>
        <p className="text-xs text-muted-foreground">Reorder: {reorder}</p>
      </div>
    </div>
  )
}

function DeliveryItem({ vendor, date, items }: any) {
  return (
    <div className="flex justify-between items-center p-2">
      <div>
        <p className="font-medium">{vendor}</p>
        <p className="text-sm text-muted-foreground">{items}</p>
      </div>
      <span className="text-sm font-medium">{date}</span>
    </div>
  )
}

function ComplianceTask({ title, status, dueDate, description }: any) {
  const statusIcons = {
    pending: Clock,
    completed: CheckCircle,
  }
  const Icon = statusIcons[status]

  return (
    <div className="flex items-start space-x-3 p-3 rounded-lg border">
      <Icon className={`h-5 w-5 mt-0.5 ${status === 'completed' ? 'text-green-600' : 'text-yellow-600'}`} />
      <div className="flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
        <p className="text-xs text-muted-foreground mt-1">Due: {dueDate}</p>
      </div>
    </div>
  )
}