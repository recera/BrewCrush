'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ReportTable } from './report-table'
import { ReportFilters } from './report-filters'
import { SavedViewsManager } from './saved-views-manager'
import { ExportControls } from './export-controls'
import { 
  RefreshCw,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package
} from 'lucide-react'

interface SupplierTrend {
  supplier_id: string
  supplier_name: string
  item_name: string
  item_type: string
  latest_price: number
  previous_price: number | null
  price_change_pct: number | null
  price_change_direction: 'up' | 'down' | 'stable' | null
  receipt_count: number
  first_receipt_date: string
  latest_receipt_date: string
  price_volatility: 'low' | 'medium' | 'high'
}

interface SupplierFilters {
  supplier?: string
  item_type?: string
  price_trend?: string
  volatility?: string
  search?: string
}

const columns = [
  { key: 'supplier_name', label: 'Supplier', sortable: true },
  { key: 'item_name', label: 'Item', sortable: true },
  { key: 'item_type', label: 'Type', sortable: true },
  { key: 'latest_price', label: 'Latest Price', sortable: true, numeric: true, currency: true },
  { key: 'previous_price', label: 'Previous Price', sortable: true, numeric: true, currency: true },
  { key: 'price_change_pct', label: 'Change %', sortable: true, numeric: true },
  { key: 'price_change_direction', label: 'Trend', sortable: true, type: 'badge' },
  { key: 'receipt_count', label: 'Receipts', sortable: true, numeric: true },
  { key: 'latest_receipt_date', label: 'Last Receipt', sortable: true, type: 'date' },
  { key: 'price_volatility', label: 'Volatility', sortable: true, type: 'badge' }
]

export function SupplierTrendsReport() {
  const [data, setData] = useState<SupplierTrend[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<SupplierFilters>({})
  const [sortField, setSortField] = useState<string>('price_change_pct')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  
  const [stats, setStats] = useState({
    total_items: 0,
    price_increases: 0,
    price_decreases: 0,
    avg_change_pct: 0
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
        .from('mv_supplier_price_trends')
        .select('*', { count: 'exact' })

      // Apply filters
      if (filters.supplier) {
        query = query.ilike('supplier_name', `%${filters.supplier}%`)
      }
      if (filters.item_type) {
        query = query.eq('item_type', filters.item_type)
      }
      if (filters.price_trend) {
        query = query.eq('price_change_direction', filters.price_trend)
      }
      if (filters.volatility) {
        query = query.eq('price_volatility', filters.volatility)
      }
      if (filters.search) {
        query = query.or(`item_name.ilike.%${filters.search}%,supplier_name.ilike.%${filters.search}%`)
      }

      // Apply sorting
      query = query.order(sortField, { ascending: sortDirection === 'asc' })

      // Apply pagination
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)

      const { data: trends, error: queryError, count } = await query

      if (queryError) throw queryError

      setData(trends || [])

      // Calculate stats
      const increases = trends?.filter(t => t.price_change_direction === 'up').length || 0
      const decreases = trends?.filter(t => t.price_change_direction === 'down').length || 0
      const avgChange = trends?.length > 0 
        ? trends.reduce((sum, t) => sum + (t.price_change_pct || 0), 0) / trends.length
        : 0

      setStats({
        total_items: count || 0,
        price_increases: increases,
        price_decreases: decreases,
        avg_change_pct: avgChange
      })

    } catch (err: any) {
      console.error('Error loading supplier trends report:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const renderCell = (trend: SupplierTrend, column: any) => {
    switch (column.key) {
      case 'price_change_direction':
        if (!trend.price_change_direction) return '—'
        const directionColors = {
          up: 'text-red-600',
          down: 'text-green-600',
          stable: 'text-gray-600'
        }
        const directionIcons = {
          up: TrendingUp,
          down: TrendingDown,
          stable: () => <span>—</span>
        }
        const Icon = directionIcons[trend.price_change_direction] || directionIcons.stable
        return (
          <div className={`flex items-center space-x-1 ${directionColors[trend.price_change_direction]}`}>
            <Icon className="h-4 w-4" />
            <span>{trend.price_change_direction}</span>
          </div>
        )

      case 'price_volatility':
        const volatilityColors = {
          low: 'bg-green-50 text-green-700 border-green-200',
          medium: 'bg-yellow-50 text-yellow-700 border-yellow-200',
          high: 'bg-red-50 text-red-700 border-red-200'
        }
        return (
          <span className={`px-2 py-1 rounded text-xs ${volatilityColors[trend.price_volatility] || 'bg-gray-50 text-gray-700'}`}>
            {trend.price_volatility}
          </span>
        )

      case 'price_change_pct':
        const changeValue = trend.price_change_pct
        if (!changeValue) return '—'
        const changeColor = changeValue > 0 ? 'text-red-600' : changeValue < 0 ? 'text-green-600' : 'text-gray-600'
        const sign = changeValue > 0 ? '+' : ''
        return <span className={changeColor}>{sign}{changeValue.toFixed(1)}%</span>

      case 'latest_price':
      case 'previous_price':
        return trend[column.key] ? `$${trend[column.key].toFixed(2)}` : '—'

      case 'latest_receipt_date':
        return new Date(trend.latest_receipt_date).toLocaleDateString()

      default:
        return trend[column.key as keyof SupplierTrend] || '—'
    }
  }

  const filterOptions = [
    {
      key: 'item_type',
      label: 'Item Type',
      type: 'select' as const,
      options: [
        { value: 'raw', label: 'Raw Materials' },
        { value: 'packaging', label: 'Packaging' },
        { value: 'misc', label: 'Miscellaneous' }
      ]
    },
    {
      key: 'price_trend',
      label: 'Price Trend',
      type: 'select' as const,
      options: [
        { value: 'up', label: 'Increasing' },
        { value: 'down', label: 'Decreasing' },
        { value: 'stable', label: 'Stable' }
      ]
    },
    {
      key: 'volatility',
      label: 'Price Volatility',
      type: 'select' as const,
      options: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' }
      ]
    },
    {
      key: 'supplier',
      label: 'Supplier',
      type: 'text' as const,
      placeholder: 'Search suppliers...'
    },
    {
      key: 'search',
      label: 'Search',
      type: 'text' as const,
      placeholder: 'Search items or suppliers...'
    }
  ]

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Items
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <Package className="h-4 w-4 text-blue-600" />
              <span className="text-2xl font-bold">{stats.total_items}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Price Increases
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <TrendingUp className="h-4 w-4 text-red-600" />
              <span className="text-2xl font-bold">{stats.price_increases}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Price Decreases
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <TrendingDown className="h-4 w-4 text-green-600" />
              <span className="text-2xl font-bold">{stats.price_decreases}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Change
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <DollarSign className="h-4 w-4 text-orange-600" />
              <span className={`text-2xl font-bold ${stats.avg_change_pct > 0 ? 'text-red-600' : stats.avg_change_pct < 0 ? 'text-green-600' : ''}`}>
                {stats.avg_change_pct > 0 ? '+' : ''}{stats.avg_change_pct.toFixed(1)}%
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex flex-col space-y-4 lg:flex-row lg:space-y-0 lg:space-x-4 lg:items-center lg:justify-between">
        <div className="flex space-x-2">
          <SavedViewsManager 
            reportType="supplier_trends"
            currentFilters={filters}
            currentSort={{ field: sortField, direction: sortDirection }}
          />
          <Button variant="outline" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        
        <ExportControls 
          reportType="supplier_trends"
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
        totalItems={stats.total_items}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  )
}