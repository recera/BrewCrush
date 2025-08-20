'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ReportTable } from './report-table'
import { ReportFilters } from './report-filters'
import { SavedViewsManager } from './saved-views-manager'
import { ExportControls } from './export-controls'
import { 
  Download,
  Filter,
  Save,
  RefreshCw,
  AlertTriangle,
  Package,
  DollarSign
} from 'lucide-react'

interface InventoryItem {
  item_id: string
  item_name: string
  item_type: string
  location_name: string
  total_qty: number
  base_uom: string
  lot_count: number
  avg_unit_cost: number | null
  total_value: number | null
  earliest_expiry: string | null
  below_reorder_level: boolean
  reorder_level: number | null
}

interface InventoryFilters {
  item_type?: string
  location?: string
  below_reorder?: boolean
  expiring_soon?: boolean
  search?: string
}

const columns = [
  { key: 'item_name', label: 'Item Name', sortable: true },
  { key: 'item_type', label: 'Type', sortable: true },
  { key: 'location_name', label: 'Location', sortable: true },
  { key: 'total_qty', label: 'Quantity', sortable: true, numeric: true },
  { key: 'base_uom', label: 'Unit', sortable: true },
  { key: 'lot_count', label: 'Lots', sortable: true, numeric: true },
  { key: 'avg_unit_cost', label: 'Avg Cost', sortable: true, numeric: true, currency: true, hiddenForRole: 'brewer' },
  { key: 'total_value', label: 'Total Value', sortable: true, numeric: true, currency: true, hiddenForRole: 'brewer' },
  { key: 'earliest_expiry', label: 'Earliest Expiry', sortable: true, type: 'date' },
  { key: 'below_reorder_level', label: 'Status', sortable: true, type: 'badge' }
]

export function InventoryReport() {
  const [data, setData] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<InventoryFilters>({})
  const [sortField, setSortField] = useState<string>('item_name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  
  // Stats
  const [stats, setStats] = useState({
    total_items: 0,
    low_stock_items: 0,
    total_value: 0,
    expiring_soon: 0
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
        .from('mv_inventory_on_hand')
        .select('*', { count: 'exact' })

      // Apply filters
      if (filters.item_type) {
        query = query.eq('item_type', filters.item_type)
      }
      if (filters.location) {
        query = query.eq('location_name', filters.location)
      }
      if (filters.below_reorder) {
        query = query.eq('below_reorder_level', true)
      }
      if (filters.expiring_soon) {
        const thirtyDaysFromNow = new Date()
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
        query = query.lte('earliest_expiry', thirtyDaysFromNow.toISOString())
      }
      if (filters.search) {
        query = query.ilike('item_name', `%${filters.search}%`)
      }

      // Apply sorting
      query = query.order(sortField, { ascending: sortDirection === 'asc' })

      // Apply pagination
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)

      const { data: items, error: queryError, count } = await query

      if (queryError) throw queryError

      setData(items || [])

      // Calculate stats
      const lowStockCount = items?.filter(item => item.below_reorder_level).length || 0
      const totalValue = items?.reduce((sum, item) => sum + (item.total_value || 0), 0) || 0
      const expiringCount = items?.filter(item => {
        if (!item.earliest_expiry) return false
        const expiryDate = new Date(item.earliest_expiry)
        const thirtyDaysFromNow = new Date()
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
        return expiryDate <= thirtyDaysFromNow
      }).length || 0

      setStats({
        total_items: count || 0,
        low_stock_items: lowStockCount,
        total_value: totalValue,
        expiring_soon: expiringCount
      })

    } catch (err: any) {
      console.error('Error loading inventory report:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Custom cell renderer for specific columns
  const renderCell = (item: InventoryItem, column: any) => {
    switch (column.key) {
      case 'below_reorder_level':
        return (
          <Badge variant={item.below_reorder_level ? 'destructive' : 'secondary'}>
            {item.below_reorder_level ? 'Low Stock' : 'In Stock'}
          </Badge>
        )
      case 'earliest_expiry':
        if (!item.earliest_expiry) return '—'
        const expiryDate = new Date(item.earliest_expiry)
        const isExpiringSoon = expiryDate <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        return (
          <span className={isExpiringSoon ? 'text-orange-600 font-medium' : ''}>
            {expiryDate.toLocaleDateString()}
          </span>
        )
      case 'avg_unit_cost':
      case 'total_value':
        return item[column.key] ? `$${item[column.key].toFixed(2)}` : '—'
      case 'total_qty':
        return `${item.total_qty} ${item.base_uom}`
      default:
        return item[column.key as keyof InventoryItem] || '—'
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
        { value: 'finished', label: 'Finished Goods' },
        { value: 'misc', label: 'Miscellaneous' }
      ]
    },
    {
      key: 'below_reorder',
      label: 'Stock Level',
      type: 'select' as const,
      options: [
        { value: 'true', label: 'Below Reorder Level' },
        { value: 'false', label: 'Above Reorder Level' }
      ]
    },
    {
      key: 'expiring_soon',
      label: 'Expiration',
      type: 'select' as const,
      options: [
        { value: 'true', label: 'Expiring Within 30 Days' }
      ]
    },
    {
      key: 'search',
      label: 'Search Items',
      type: 'text' as const,
      placeholder: 'Search by item name...'
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
              Low Stock Items
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="h-4 w-4 text-orange-600" />
              <span className="text-2xl font-bold">{stats.low_stock_items}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Value
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <DollarSign className="h-4 w-4 text-green-600" />
              <span className="text-2xl font-bold">
                ${stats.total_value.toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Expiring Soon
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <span className="text-2xl font-bold">{stats.expiring_soon}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex flex-col space-y-4 lg:flex-row lg:space-y-0 lg:space-x-4 lg:items-center lg:justify-between">
        <div className="flex space-x-2">
          <SavedViewsManager reportType="inventory" />
          <Button variant="outline" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        
        <ExportControls 
          reportType="inventory"
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