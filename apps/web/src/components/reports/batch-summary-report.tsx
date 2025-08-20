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
  FlaskConical,
  TrendingUp,
  DollarSign,
  Target
} from 'lucide-react'

interface BatchSummary {
  batch_id: string
  batch_number: string
  recipe_name: string
  style: string
  status: string
  brew_date: string
  target_volume: number
  actual_volume: number
  packaged_liters: number
  yield_percentage: number
  og_target: number | null
  og_actual: number | null
  fg_actual: number | null
  abv_actual: number | null
  ingredient_cost: number | null
  packaging_cost: number | null
  total_cost: number | null
  cost_per_liter: number | null
  total_duration_days: number | null
}

interface BatchFilters {
  status?: string
  style?: string
  recipe?: string
  date_range?: string
  yield_threshold?: string
  search?: string
}

const columns = [
  { key: 'batch_number', label: 'Batch #', sortable: true },
  { key: 'recipe_name', label: 'Recipe', sortable: true },
  { key: 'style', label: 'Style', sortable: true },
  { key: 'status', label: 'Status', sortable: true, type: 'badge' },
  { key: 'brew_date', label: 'Brew Date', sortable: true, type: 'date' },
  { key: 'target_volume', label: 'Target (L)', sortable: true, numeric: true },
  { key: 'actual_volume', label: 'Actual (L)', sortable: true, numeric: true },
  { key: 'packaged_liters', label: 'Packaged (L)', sortable: true, numeric: true },
  { key: 'yield_percentage', label: 'Yield %', sortable: true, numeric: true },
  { key: 'og_actual', label: 'OG', sortable: true, numeric: true },
  { key: 'fg_actual', label: 'FG', sortable: true, numeric: true },
  { key: 'abv_actual', label: 'ABV %', sortable: true, numeric: true },
  { key: 'ingredient_cost', label: 'Ingredient Cost', sortable: true, numeric: true, currency: true, hiddenForRole: 'brewer' },
  { key: 'packaging_cost', label: 'Packaging Cost', sortable: true, numeric: true, currency: true, hiddenForRole: 'brewer' },
  { key: 'total_cost', label: 'Total Cost', sortable: true, numeric: true, currency: true, hiddenForRole: 'brewer' },
  { key: 'cost_per_liter', label: 'Cost/L', sortable: true, numeric: true, currency: true, hiddenForRole: 'brewer' },
  { key: 'total_duration_days', label: 'Duration (days)', sortable: true, numeric: true }
]

export function BatchSummaryReport() {
  const [data, setData] = useState<BatchSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<BatchFilters>({})
  const [sortField, setSortField] = useState<string>('brew_date')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  
  // Stats
  const [stats, setStats] = useState({
    total_batches: 0,
    avg_yield: 0,
    avg_abv: 0,
    total_cost: 0,
    avg_duration: 0
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
        .from('mv_batch_summary')
        .select('*', { count: 'exact' })

      // Apply filters
      if (filters.status) {
        query = query.eq('status', filters.status)
      }
      if (filters.style) {
        query = query.eq('style', filters.style)
      }
      if (filters.recipe) {
        query = query.ilike('recipe_name', `%${filters.recipe}%`)
      }
      if (filters.search) {
        query = query.or(`batch_number.ilike.%${filters.search}%,recipe_name.ilike.%${filters.search}%`)
      }
      if (filters.yield_threshold) {
        const threshold = parseFloat(filters.yield_threshold)
        if (filters.yield_threshold === 'low') {
          query = query.lt('yield_percentage', 80)
        } else if (filters.yield_threshold === 'high') {
          query = query.gte('yield_percentage', 90)
        }
      }
      if (filters.date_range) {
        const now = new Date()
        let startDate: Date
        
        switch (filters.date_range) {
          case 'last_30_days':
            startDate = new Date(now.setDate(now.getDate() - 30))
            break
          case 'last_90_days':
            startDate = new Date(now.setDate(now.getDate() - 90))
            break
          case 'last_year':
            startDate = new Date(now.setFullYear(now.getFullYear() - 1))
            break
          default:
            startDate = new Date(0)
        }
        
        query = query.gte('brew_date', startDate.toISOString())
      }

      // Apply sorting
      query = query.order(sortField, { ascending: sortDirection === 'asc' })

      // Apply pagination
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)

      const { data: batches, error: queryError, count } = await query

      if (queryError) throw queryError

      setData(batches || [])

      // Calculate stats
      const totalYield = batches?.reduce((sum, batch) => sum + (batch.yield_percentage || 0), 0) || 0
      const totalAbv = batches?.reduce((sum, batch) => sum + (batch.abv_actual || 0), 0) || 0
      const totalCostSum = batches?.reduce((sum, batch) => sum + (batch.total_cost || 0), 0) || 0
      const totalDuration = batches?.reduce((sum, batch) => sum + (batch.total_duration_days || 0), 0) || 0
      const batchCount = batches?.length || 0

      setStats({
        total_batches: count || 0,
        avg_yield: batchCount > 0 ? totalYield / batchCount : 0,
        avg_abv: batchCount > 0 ? totalAbv / batchCount : 0,
        total_cost: totalCostSum,
        avg_duration: batchCount > 0 ? totalDuration / batchCount : 0
      })

    } catch (err: any) {
      console.error('Error loading batch summary report:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Custom cell renderer
  const renderCell = (batch: BatchSummary, column: any) => {
    switch (column.key) {
      case 'status':
        const statusColors = {
          'planned': 'bg-blue-50 text-blue-700 border-blue-200',
          'brewing': 'bg-yellow-50 text-yellow-700 border-yellow-200',
          'fermenting': 'bg-orange-50 text-orange-700 border-orange-200',
          'conditioning': 'bg-purple-50 text-purple-700 border-purple-200',
          'packaging': 'bg-green-50 text-green-700 border-green-200',
          'completed': 'bg-gray-50 text-gray-700 border-gray-200'
        }
        return (
          <Badge 
            variant="outline" 
            className={statusColors[batch.status as keyof typeof statusColors] || 'bg-gray-50 text-gray-700 border-gray-200'}
          >
            {batch.status}
          </Badge>
        )
      
      case 'yield_percentage':
        const yieldValue = batch.yield_percentage
        let yieldColor = 'text-gray-600'
        if (yieldValue >= 90) yieldColor = 'text-green-600 font-medium'
        else if (yieldValue < 80) yieldColor = 'text-red-600 font-medium'
        else if (yieldValue < 85) yieldColor = 'text-orange-600'
        
        return <span className={yieldColor}>{yieldValue?.toFixed(1)}%</span>

      case 'og_actual':
      case 'fg_actual':
        return batch[column.key] ? batch[column.key]?.toFixed(3) : '—'

      case 'abv_actual':
        return batch.abv_actual ? `${batch.abv_actual.toFixed(1)}%` : '—'

      case 'ingredient_cost':
      case 'packaging_cost':
      case 'total_cost':
      case 'cost_per_liter':
        return batch[column.key] ? `$${batch[column.key].toFixed(2)}` : '—'

      case 'brew_date':
        return new Date(batch.brew_date).toLocaleDateString()

      case 'target_volume':
      case 'actual_volume':
      case 'packaged_liters':
        return batch[column.key] ? batch[column.key].toLocaleString() : '—'

      default:
        return batch[column.key as keyof BatchSummary] || '—'
    }
  }

  const filterOptions = [
    {
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: 'planned', label: 'Planned' },
        { value: 'brewing', label: 'Brewing' },
        { value: 'fermenting', label: 'Fermenting' },
        { value: 'conditioning', label: 'Conditioning' },
        { value: 'packaging', label: 'Packaging' },
        { value: 'completed', label: 'Completed' }
      ]
    },
    {
      key: 'date_range',
      label: 'Date Range',
      type: 'select' as const,
      options: [
        { value: 'last_30_days', label: 'Last 30 Days' },
        { value: 'last_90_days', label: 'Last 90 Days' },
        { value: 'last_year', label: 'Last Year' }
      ]
    },
    {
      key: 'yield_threshold',
      label: 'Yield Performance',
      type: 'select' as const,
      options: [
        { value: 'low', label: 'Low Yield (<80%)' },
        { value: 'high', label: 'High Yield (≥90%)' }
      ]
    },
    {
      key: 'recipe',
      label: 'Recipe',
      type: 'text' as const,
      placeholder: 'Search recipes...'
    },
    {
      key: 'search',
      label: 'Search',
      type: 'text' as const,
      placeholder: 'Search batch number or recipe...'
    }
  ]

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Batches
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <FlaskConical className="h-4 w-4 text-blue-600" />
              <span className="text-2xl font-bold">{stats.total_batches}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Yield
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <Target className="h-4 w-4 text-green-600" />
              <span className="text-2xl font-bold">{stats.avg_yield.toFixed(1)}%</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg ABV
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <TrendingUp className="h-4 w-4 text-orange-600" />
              <span className="text-2xl font-bold">{stats.avg_abv.toFixed(1)}%</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Cost
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <DollarSign className="h-4 w-4 text-red-600" />
              <span className="text-2xl font-bold">
                ${stats.total_cost.toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Duration
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <FlaskConical className="h-4 w-4 text-purple-600" />
              <span className="text-2xl font-bold">{Math.round(stats.avg_duration)} days</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex flex-col space-y-4 lg:flex-row lg:space-y-0 lg:space-x-4 lg:items-center lg:justify-between">
        <div className="flex space-x-2">
          <SavedViewsManager 
            reportType="batch_summary"
            currentFilters={filters}
            currentSort={{ field: sortField, direction: sortDirection }}
          />
          <Button variant="outline" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        
        <ExportControls 
          reportType="batch_summary"
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
        totalItems={stats.total_batches}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  )
}