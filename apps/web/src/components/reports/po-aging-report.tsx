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
  FileText,
  AlertCircle,
  Clock,
  CheckCircle
} from 'lucide-react'

interface POAging {
  po_id: string
  po_number: string
  vendor_name: string
  status: string
  order_date: string
  expected_delivery_date: string | null
  days_since_order: number
  days_overdue: number
  total_value: number
  received_value: number
  outstanding_value: number
  completion_pct: number
  age_category: 'on_time' | 'due_soon' | 'overdue' | 'severely_overdue'
}

interface POFilters {
  status?: string
  vendor?: string
  age_category?: string
  overdue_only?: boolean
  search?: string
}

const columns = [
  { key: 'po_number', label: 'PO Number', sortable: true },
  { key: 'vendor_name', label: 'Vendor', sortable: true },
  { key: 'status', label: 'Status', sortable: true, type: 'badge' },
  { key: 'order_date', label: 'Order Date', sortable: true, type: 'date' },
  { key: 'expected_delivery_date', label: 'Expected Delivery', sortable: true, type: 'date' },
  { key: 'days_since_order', label: 'Days Since Order', sortable: true, numeric: true },
  { key: 'days_overdue', label: 'Days Overdue', sortable: true, numeric: true },
  { key: 'total_value', label: 'Total Value', sortable: true, numeric: true, currency: true },
  { key: 'received_value', label: 'Received Value', sortable: true, numeric: true, currency: true },
  { key: 'outstanding_value', label: 'Outstanding', sortable: true, numeric: true, currency: true },
  { key: 'completion_pct', label: 'Completion %', sortable: true, numeric: true },
  { key: 'age_category', label: 'Age Status', sortable: true, type: 'badge' }
]

export function POAgingReport() {
  const [data, setData] = useState<POAging[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<POFilters>({})
  const [sortField, setSortField] = useState<string>('days_since_order')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  
  const [stats, setStats] = useState({
    total_pos: 0,
    overdue_pos: 0,
    total_outstanding_value: 0,
    avg_completion: 0
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
        .from('mv_po_aging')
        .select('*', { count: 'exact' })

      // Apply filters
      if (filters.status) {
        query = query.eq('status', filters.status)
      }
      if (filters.vendor) {
        query = query.ilike('vendor_name', `%${filters.vendor}%`)
      }
      if (filters.age_category) {
        query = query.eq('age_category', filters.age_category)
      }
      if (filters.overdue_only) {
        query = query.gt('days_overdue', 0)
      }
      if (filters.search) {
        query = query.or(`po_number.ilike.%${filters.search}%,vendor_name.ilike.%${filters.search}%`)
      }

      // Apply sorting
      query = query.order(sortField, { ascending: sortDirection === 'asc' })

      // Apply pagination
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)

      const { data: pos, error: queryError, count } = await query

      if (queryError) throw queryError

      setData(pos || [])

      // Calculate stats
      const overdueCount = pos?.filter(po => po.days_overdue > 0).length || 0
      const totalOutstanding = pos?.reduce((sum, po) => sum + (po.outstanding_value || 0), 0) || 0
      const avgCompletion = pos?.length > 0 
        ? pos.reduce((sum, po) => sum + (po.completion_pct || 0), 0) / pos.length 
        : 0

      setStats({
        total_pos: count || 0,
        overdue_pos: overdueCount,
        total_outstanding_value: totalOutstanding,
        avg_completion: avgCompletion
      })

    } catch (err: any) {
      console.error('Error loading PO aging report:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const renderCell = (po: POAging, column: any) => {
    switch (column.key) {
      case 'status':
        const statusColors = {
          'draft': 'bg-gray-50 text-gray-700 border-gray-200',
          'approved': 'bg-blue-50 text-blue-700 border-blue-200',
          'partial': 'bg-yellow-50 text-yellow-700 border-yellow-200',
          'received': 'bg-green-50 text-green-700 border-green-200',
          'closed': 'bg-gray-50 text-gray-700 border-gray-200'
        }
        return (
          <Badge 
            variant="outline" 
            className={statusColors[po.status as keyof typeof statusColors] || 'bg-gray-50 text-gray-700 border-gray-200'}
          >
            {po.status}
          </Badge>
        )

      case 'age_category':
        const ageColors = {
          'on_time': 'bg-green-50 text-green-700 border-green-200',
          'due_soon': 'bg-yellow-50 text-yellow-700 border-yellow-200',
          'overdue': 'bg-orange-50 text-orange-700 border-orange-200',
          'severely_overdue': 'bg-red-50 text-red-700 border-red-200'
        }
        const ageLabels = {
          'on_time': 'On Time',
          'due_soon': 'Due Soon',
          'overdue': 'Overdue',
          'severely_overdue': 'Severely Overdue'
        }
        return (
          <Badge 
            variant="outline" 
            className={ageColors[po.age_category] || 'bg-gray-50 text-gray-700 border-gray-200'}
          >
            {ageLabels[po.age_category] || po.age_category}
          </Badge>
        )

      case 'completion_pct':
        const completionValue = po.completion_pct
        let completionColor = 'text-gray-600'
        if (completionValue >= 100) completionColor = 'text-green-600 font-medium'
        else if (completionValue >= 80) completionColor = 'text-blue-600'
        else if (completionValue < 50) completionColor = 'text-red-600'
        
        return <span className={completionColor}>{completionValue.toFixed(0)}%</span>

      case 'days_overdue':
        return po.days_overdue > 0 ? (
          <span className="text-red-600 font-medium">{po.days_overdue}</span>
        ) : (
          <span className="text-green-600">—</span>
        )

      case 'expected_delivery_date':
        return po.expected_delivery_date ? new Date(po.expected_delivery_date).toLocaleDateString() : '—'

      case 'order_date':
        return new Date(po.order_date).toLocaleDateString()

      case 'total_value':
      case 'received_value':
      case 'outstanding_value':
        return po[column.key] ? `$${po[column.key].toFixed(2)}` : '—'

      default:
        return po[column.key as keyof POAging] || '—'
    }
  }

  const filterOptions = [
    {
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'approved', label: 'Approved' },
        { value: 'partial', label: 'Partially Received' },
        { value: 'received', label: 'Fully Received' },
        { value: 'closed', label: 'Closed' }
      ]
    },
    {
      key: 'age_category',
      label: 'Age Status',
      type: 'select' as const,
      options: [
        { value: 'on_time', label: 'On Time' },
        { value: 'due_soon', label: 'Due Soon' },
        { value: 'overdue', label: 'Overdue' },
        { value: 'severely_overdue', label: 'Severely Overdue' }
      ]
    },
    {
      key: 'vendor',
      label: 'Vendor',
      type: 'text' as const,
      placeholder: 'Search vendors...'
    },
    {
      key: 'search',
      label: 'Search',
      type: 'text' as const,
      placeholder: 'Search PO number or vendor...'
    }
  ]

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total POs
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <FileText className="h-4 w-4 text-blue-600" />
              <span className="text-2xl font-bold">{stats.total_pos}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Overdue POs
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-2xl font-bold">{stats.overdue_pos}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Outstanding Value
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-orange-600" />
              <span className="text-2xl font-bold">
                ${stats.total_outstanding_value.toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Completion
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-2xl font-bold">{stats.avg_completion.toFixed(0)}%</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex flex-col space-y-4 lg:flex-row lg:space-y-0 lg:space-x-4 lg:items-center lg:justify-between">
        <div className="flex space-x-2">
          <SavedViewsManager 
            reportType="po_aging"
            currentFilters={filters}
            currentSort={{ field: sortField, direction: sortDirection }}
          />
          <Button variant="outline" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        
        <ExportControls 
          reportType="po_aging"
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
        totalItems={stats.total_pos}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  )
}