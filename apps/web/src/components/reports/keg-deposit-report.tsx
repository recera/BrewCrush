'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ReportTable } from './report-table'
import { ReportFilters } from './report-filters'
import { SavedViewsManager } from './saved-views-manager'
import { ExportControls } from './export-controls'
import { 
  RefreshCw,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Users
} from 'lucide-react'

interface KegDepositSummary {
  customer_id: string | null
  customer_name: string
  sku_code: string
  sku_description: string
  total_charged: number
  total_returned: number
  outstanding_deposits: number
  outstanding_kegs: number
  last_transaction_date: string
  liability_status: 'current' | 'overdue' | 'aging'
}

interface KegDepositFilters {
  customer?: string
  sku?: string
  liability_status?: string
  has_outstanding?: boolean
  search?: string
}

const columns = [
  { key: 'customer_name', label: 'Customer', sortable: true },
  { key: 'sku_code', label: 'SKU', sortable: true },
  { key: 'sku_description', label: 'Description', sortable: true },
  { key: 'total_charged', label: 'Total Charged', sortable: true, numeric: true, currency: true },
  { key: 'total_returned', label: 'Total Returned', sortable: true, numeric: true, currency: true },
  { key: 'outstanding_deposits', label: 'Outstanding Amount', sortable: true, numeric: true, currency: true },
  { key: 'outstanding_kegs', label: 'Outstanding Kegs', sortable: true, numeric: true },
  { key: 'last_transaction_date', label: 'Last Transaction', sortable: true, type: 'date' },
  { key: 'liability_status', label: 'Status', sortable: true, type: 'badge' }
]

export function KegDepositReport() {
  const [data, setData] = useState<KegDepositSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<KegDepositFilters>({})
  const [sortField, setSortField] = useState<string>('outstanding_deposits')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  
  const [stats, setStats] = useState({
    total_customers: 0,
    total_charged: 0,
    total_returned: 0,
    total_outstanding: 0
  })

  const supabase = createClient()

  useEffect(() => {
    loadData()
  }, [filters, sortField, sortDirection, page, pageSize])

  const loadData = async () => {
    setLoading(true)
    setError(null)

    try {
      let query = supabase
        .from('mv_keg_deposit_summary')
        .select('*', { count: 'exact' })

      // Apply filters
      if (filters.customer) {
        query = query.ilike('customer_name', `%${filters.customer}%`)
      }
      if (filters.sku) {
        query = query.ilike('sku_code', `%${filters.sku}%`)
      }
      if (filters.liability_status) {
        query = query.eq('liability_status', filters.liability_status)
      }
      if (filters.has_outstanding) {
        query = query.gt('outstanding_deposits', 0)
      }
      if (filters.search) {
        query = query.or(`customer_name.ilike.%${filters.search}%,sku_code.ilike.%${filters.search}%`)
      }

      // Apply sorting
      query = query.order(sortField, { ascending: sortDirection === 'asc' })

      // Apply pagination
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)

      const { data: deposits, error: queryError, count } = await query

      if (queryError) throw queryError

      setData(deposits || [])

      // Calculate stats
      const uniqueCustomers = new Set(deposits?.map(d => d.customer_id).filter(Boolean)).size
      const totalCharged = deposits?.reduce((sum, d) => sum + (d.total_charged || 0), 0) || 0
      const totalReturned = deposits?.reduce((sum, d) => sum + (d.total_returned || 0), 0) || 0
      const totalOutstanding = deposits?.reduce((sum, d) => sum + (d.outstanding_deposits || 0), 0) || 0

      setStats({
        total_customers: uniqueCustomers,
        total_charged: totalCharged,
        total_returned: totalReturned,
        total_outstanding: totalOutstanding
      })

    } catch (err: any) {
      console.error('Error loading keg deposit report:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const renderCell = (deposit: KegDepositSummary, column: any) => {
    switch (column.key) {
      case 'liability_status':
        const statusColors = {
          current: 'bg-green-50 text-green-700 border-green-200',
          overdue: 'bg-orange-50 text-orange-700 border-orange-200',
          aging: 'bg-red-50 text-red-700 border-red-200'
        }
        return (
          <Badge 
            variant="outline" 
            className={statusColors[deposit.liability_status] || 'bg-gray-50 text-gray-700 border-gray-200'}
          >
            {deposit.liability_status}
          </Badge>
        )

      case 'total_charged':
      case 'total_returned':
      case 'outstanding_deposits':
        const value = deposit[column.key]
        let colorClass = ''
        if (column.key === 'outstanding_deposits' && value > 0) {
          colorClass = value > 100 ? 'text-red-600 font-medium' : 'text-orange-600'
        }
        return <span className={colorClass}>{value ? `$${value.toFixed(2)}` : '$0.00'}</span>

      case 'outstanding_kegs':
        const kegs = deposit.outstanding_kegs
        return (
          <span className={kegs > 5 ? 'text-orange-600 font-medium' : ''}>
            {kegs || 0}
          </span>
        )

      case 'last_transaction_date':
        return new Date(deposit.last_transaction_date).toLocaleDateString()

      default:
        return deposit[column.key as keyof KegDepositSummary] || '—'
    }
  }

  const filterOptions = [
    {
      key: 'liability_status',
      label: 'Liability Status',
      type: 'select' as const,
      options: [
        { value: 'current', label: 'Current' },
        { value: 'overdue', label: 'Overdue' },
        { value: 'aging', label: 'Aging' }
      ]
    },
    {
      key: 'has_outstanding',
      label: 'Outstanding Deposits',
      type: 'select' as const,
      options: [
        { value: 'true', label: 'Has Outstanding Deposits' }
      ]
    },
    {
      key: 'customer',
      label: 'Customer',
      type: 'text' as const,
      placeholder: 'Search customers...'
    },
    {
      key: 'sku',
      label: 'SKU',
      type: 'text' as const,
      placeholder: 'Search SKUs...'
    },
    {
      key: 'search',
      label: 'Search',
      type: 'text' as const,
      placeholder: 'Search customers or SKUs...'
    }
  ]

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Customers
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <Users className="h-4 w-4 text-blue-600" />
              <span className="text-2xl font-bold">{stats.total_customers}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Charged
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <span className="text-2xl font-bold">
                ${stats.total_charged.toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Returned
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <TrendingDown className="h-4 w-4 text-blue-600" />
              <span className="text-2xl font-bold">
                ${stats.total_returned.toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Outstanding Liability
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <DollarSign className="h-4 w-4 text-red-600" />
              <span className="text-2xl font-bold text-red-600">
                ${stats.total_outstanding.toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex flex-col space-y-4 lg:flex-row lg:space-y-0 lg:space-x-4 lg:items-center lg:justify-between">
        <div className="flex space-x-2">
          <SavedViewsManager 
            reportType="keg_deposits"
            currentFilters={filters}
            currentSort={{ field: sortField, direction: sortDirection }}
          />
          <Button variant="outline" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        
        <ExportControls 
          reportType="keg_deposits"
          filters={filters}
          sort={{ field: sortField, direction: sortDirection }}
        />
      </div>

      {/* Filters */}
      <ReportFilters
        filters={filters}
        onFiltersChange={setFilters}
        filterOptions={filterOptions}
      />

      {/* Table */}
      <ReportTable
        data={data}
        columns={columns}
        loading={loading}
        error={error}
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={(field, direction) => {
          setSortField(field)
          setSortDirection(direction)
        }}
        renderCell={renderCell}
        page={page}
        pageSize={pageSize}
        totalItems={stats.total_customers}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      {/* Export to QBO Info */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-4">
          <div className="flex items-start space-x-3">
            <DollarSign className="h-5 w-5 text-blue-600 mt-0.5" />
            <div>
              <h4 className="font-medium text-blue-900">QuickBooks Integration</h4>
              <p className="text-sm text-blue-700 mt-1">
                Keg deposit data can be exported to QuickBooks as liability entries. 
                Configure the liability account mapping in Settings → Integrations.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}