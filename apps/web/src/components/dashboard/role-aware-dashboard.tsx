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
  Beer,
  Activity,
  BarChart3
} from 'lucide-react'

interface RoleAwareDashboardProps {
  role: string
  workspace: any
}

interface DashboardStats {
  inventory_value?: number
  monthly_production_bbls?: number
  active_batches?: number
  tank_utilization?: number
  open_pos?: number
  compliance_status?: string
  tanks_in_use?: number
  total_tanks?: number
  conditioning_batches?: number
  ready_to_package?: number
  readings_due?: number
  low_stock_items?: number
  pending_receiving?: number
}

export function RoleAwareDashboard({ role, workspace }: RoleAwareDashboardProps) {
  const [stats, setStats] = useState<DashboardStats>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    loadDashboardData()
    
    // Set up real-time subscriptions for key tables
    const channel = supabase
      .channel('dashboard-updates')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'batches' }, 
        () => loadDashboardData()
      )
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'purchase_orders' }, 
        () => loadDashboardData()
      )
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'inventory_transactions' }, 
        () => loadDashboardData()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [role])

  const loadDashboardData = async () => {
    setLoading(true)
    setError(null)
    
    try {
      // Load data using the new dashboard stats function
      const { data, error: rpcError } = await supabase.rpc('get_dashboard_stats', {
        p_workspace_id: workspace.id,
        p_role: role
      })

      if (rpcError) {
        throw rpcError
      }

      setStats(data || {})

      // Load additional role-specific data
      if (role === 'brewer') {
        // Get readings due count
        const { data: readingsData } = await supabase
          .from('batches')
          .select('id')
          .in('status', ['fermenting', 'conditioning'])
          .not('ferm_readings', 'cs', `{${new Date().toISOString().split('T')[0]}}`)

        setStats(prev => ({ 
          ...prev, 
          readings_due: readingsData?.length || 0 
        }))
      }

    } catch (error: any) {
      console.error('Error loading dashboard data:', error)
      setError(error.message)
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
          {error && (
            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">Error loading data: {error}</p>
            </div>
          )}
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <StatCard
            title="Inventory Value"
            value={loading ? '...' : (stats.inventory_value ? `$${(stats.inventory_value).toLocaleString()}` : '$0')}
            icon={Package}
            loading={loading}
          />
          <StatCard
            title="Monthly Production"
            value={loading ? '...' : (stats.monthly_production_bbls ? `${Math.round(stats.monthly_production_bbls)} BBL` : '0 BBL')}
            icon={FlaskConical}
            loading={loading}
          />
          <StatCard
            title="Open POs"
            value={loading ? '...' : (stats.open_pos || 0)}
            icon={FileText}
            loading={loading}
          />
          <StatCard
            title="Tank Utilization"
            value={loading ? '...' : (stats.tank_utilization ? `${Math.round(stats.tank_utilization)}%` : '0%')}
            icon={Activity}
            loading={loading}
            status={stats.tank_utilization && stats.tank_utilization > 85 ? 'warning' : 'default'}
          />
        </div>

        {/* Quick Actions */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <QuickActionCard
            title="Production Overview"
            description={loading ? '...' : `${stats.active_batches || 0} active batches, ${stats.ready_to_package || 0} ready to package`}
            icon={FlaskConical}
            href="/production"
          />
          <QuickActionCard
            title="Inventory Alert"
            description={loading ? '...' : `${stats.low_stock_items || 0} items below reorder level`}
            icon={AlertCircle}
            href="/inventory"
            variant={stats.low_stock_items > 0 ? 'warning' : 'default'}
          />
          <QuickActionCard
            title="Compliance Status"
            description={loading ? '...' : (stats.compliance_status === 'due_soon' ? 'BROP due soon' : stats.compliance_status === 'overdue' ? 'BROP overdue' : 'All filings current')}
            icon={FileText}
            href="/compliance"
            variant={stats.compliance_status === 'overdue' ? 'urgent' : stats.compliance_status === 'due_soon' ? 'warning' : 'default'}
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
          {error && (
            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">Error loading data: {error}</p>
            </div>
          )}
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <StatCard
            title="Active Batches"
            value={loading ? '...' : (stats.active_batches || 0)}
            icon={Beer}
            loading={loading}
          />
          <StatCard
            title="Tank Usage"
            value={loading ? '...' : `${stats.tanks_in_use || 0}/${stats.total_tanks || 0}`}
            icon={FlaskConical}
            loading={loading}
          />
          <StatCard
            title="Conditioning"
            value={loading ? '...' : (stats.conditioning_batches || 0)}
            icon={Activity}
            loading={loading}
          />
          <StatCard
            title="Readings Due"
            value={loading ? '...' : (stats.readings_due || 0)}
            icon={Clock}
            loading={loading}
            status={stats.readings_due && stats.readings_due > 0 ? 'warning' : 'default'}
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
          {error && (
            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">Error loading data: {error}</p>
            </div>
          )}
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <StatCard
            title="Low Stock Items"
            value={loading ? '...' : (stats.low_stock_items || 0)}
            icon={AlertCircle}
            loading={loading}
            status={stats.low_stock_items && stats.low_stock_items > 5 ? 'warning' : 'default'}
          />
          <StatCard
            title="Pending Receiving"
            value={loading ? '...' : (stats.pending_receiving || 0)}
            icon={Package}
            loading={loading}
          />
          <StatCard
            title="Open POs"
            value={loading ? '...' : (stats.open_pos || 0)}
            icon={FileText}
            loading={loading}
          />
          <StatCard
            title="Inventory Value"
            value={loading ? '...' : (stats.inventory_value ? `$${(stats.inventory_value).toLocaleString()}` : '$0')}
            icon={DollarSign}
            loading={loading}
          />
        </div>

        {/* Inventory Details */}
        <div className="grid gap-6 md:grid-cols-2">
          <InventoryAlerts loading={loading} stats={stats} />
          <ExpectedDeliveries loading={loading} stats={stats} />
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
          {error && (
            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">Error loading data: {error}</p>
            </div>
          )}
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <StatCard
            title="Inventory Value"
            value={loading ? '...' : (stats.inventory_value ? `$${(stats.inventory_value).toLocaleString()}` : '$0')}
            icon={DollarSign}
            loading={loading}
          />
          <StatCard
            title="Monthly Production"
            value={loading ? '...' : (stats.monthly_production_bbls ? `${Math.round(stats.monthly_production_bbls)} BBL` : '0 BBL')}
            icon={BarChart3}
            loading={loading}
          />
          <StatCard
            title="BROP Status"
            value={loading ? '...' : (stats.compliance_status || 'Current')}
            icon={Clock}
            loading={loading}
            status={stats.compliance_status === 'overdue' ? 'error' : stats.compliance_status === 'due_soon' ? 'warning' : 'success'}
          />
          <StatCard
            title="Open POs"
            value={loading ? '...' : (stats.open_pos || 0)}
            icon={FileText}
            loading={loading}
          />
        </div>

        {/* Compliance Status */}
        <ComplianceStatus loading={loading} stats={stats} />
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
  status = 'default',
  loading = false 
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
      <p className={`text-2xl font-bold ${loading ? 'animate-pulse' : ''}`}>{value}</p>
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

// Additional components for inventory and compliance dashboards
function InventoryAlerts({ loading, stats }: any) {
  const [lowStockItems, setLowStockItems] = useState<any[]>([])
  const supabase = createClient()

  useEffect(() => {
    loadLowStockItems()
  }, [])

  const loadLowStockItems = async () => {
    try {
      const { data } = await supabase
        .from('mv_inventory_on_hand')
        .select('item_name, total_qty, base_uom, reorder_level')
        .eq('below_reorder_level', true)
        .limit(5)

      setLowStockItems(data || [])
    } catch (error) {
      console.error('Error loading low stock items:', error)
    }
  }

  return (
    <div className="bg-card rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-4">Low Stock Alert</h2>
      {loading ? (
        <div className="space-y-2">
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded mb-2"></div>
            <div className="h-4 bg-gray-200 rounded mb-2"></div>
            <div className="h-4 bg-gray-200 rounded"></div>
          </div>
        </div>
      ) : lowStockItems.length > 0 ? (
        <div className="space-y-2">
          {lowStockItems.map((item, index) => (
            <LowStockItem
              key={index}
              name={item.item_name}
              current={`${item.total_qty} ${item.base_uom}`}
              reorder={`${item.reorder_level} ${item.base_uom}`}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">All items are above reorder levels</p>
      )}
    </div>
  )
}

function ExpectedDeliveries({ loading, stats }: any) {
  const [pendingPOs, setPendingPOs] = useState<any[]>([])
  const supabase = createClient()

  useEffect(() => {
    loadPendingPOs()
  }, [])

  const loadPendingPOs = async () => {
    try {
      const { data } = await supabase
        .from('purchase_orders')
        .select(`
          vendor:vendors(name),
          expected_delivery_date,
          po_lines(count)
        `)
        .in('status', ['approved', 'partial'])
        .order('expected_delivery_date')
        .limit(5)

      setPendingPOs(data || [])
    } catch (error) {
      console.error('Error loading pending POs:', error)
    }
  }

  const formatDeliveryDate = (date: string) => {
    if (!date) return 'TBD'
    const deliveryDate = new Date(date)
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    if (deliveryDate.toDateString() === today.toDateString()) return 'Today'
    if (deliveryDate.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
    
    return deliveryDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  return (
    <div className="bg-card rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-4">Expected Deliveries</h2>
      {loading ? (
        <div className="space-y-2">
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded mb-2"></div>
            <div className="h-4 bg-gray-200 rounded mb-2"></div>
            <div className="h-4 bg-gray-200 rounded"></div>
          </div>
        </div>
      ) : pendingPOs.length > 0 ? (
        <div className="space-y-2">
          {pendingPOs.map((po, index) => (
            <DeliveryItem
              key={index}
              vendor={po.vendor?.name || 'Unknown Vendor'}
              date={formatDeliveryDate(po.expected_delivery_date)}
              items={`${po.po_lines?.[0]?.count || 0} items`}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No pending deliveries</p>
      )}
    </div>
  )
}

function ComplianceStatus({ loading, stats }: any) {
  const [complianceTasks, setComplianceTasks] = useState<any[]>([])
  const supabase = createClient()

  useEffect(() => {
    loadComplianceTasks()
  }, [])

  const loadComplianceTasks = async () => {
    try {
      const { data } = await supabase
        .from('ttb_periods')
        .select('type, period_start, period_end, status, due_date')
        .order('due_date', { ascending: true })
        .limit(5)

      const tasks = (data || []).map((period: any) => ({
        title: `${period.type === 'monthly' ? 'Monthly' : 'Quarterly'} BROP`,
        status: period.status === 'finalized' ? 'completed' : 'pending',
        dueDate: new Date(period.due_date).toLocaleDateString(),
        description: `${period.type === 'monthly' ? 'Form 5130.9' : 'Form 5130.26'} - ${new Date(period.period_start).toLocaleDateString()} to ${new Date(period.period_end).toLocaleDateString()}`
      }))

      setComplianceTasks(tasks)
    } catch (error) {
      console.error('Error loading compliance tasks:', error)
    }
  }

  return (
    <div className="bg-card rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-4">Compliance Tasks</h2>
      {loading ? (
        <div className="space-y-3">
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded mb-2"></div>
            <div className="h-4 bg-gray-200 rounded mb-2"></div>
            <div className="h-4 bg-gray-200 rounded"></div>
          </div>
        </div>
      ) : complianceTasks.length > 0 ? (
        <div className="space-y-3">
          {complianceTasks.map((task, index) => (
            <ComplianceTask
              key={index}
              title={task.title}
              status={task.status}
              dueDate={task.dueDate}
              description={task.description}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No compliance tasks found</p>
      )}
    </div>
  )
}