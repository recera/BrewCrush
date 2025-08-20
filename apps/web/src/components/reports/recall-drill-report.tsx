'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ReportTable } from './report-table'
import { ExportControls } from './export-controls'
import { 
  Search,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  MapPin,
  Users,
  Package
} from 'lucide-react'

interface RecallTraceItem {
  trace_direction: 'upstream' | 'downstream'
  level_type: 'ingredient' | 'batch' | 'finished_product' | 'shipment' | 'customer'
  level_number: number
  entity_type: string
  entity_name: string
  entity_id: string
  relationship_type: string
  quantity: number | null
  uom: string | null
  date_related: string
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  additional_info: Record<string, any>
}

interface RecallImpactSummary {
  total_upstream_items: number
  total_downstream_items: number
  affected_customers: number
  total_quantity_affected: number
  risk_assessment: string
  estimated_cost_impact: number | null
}

interface EntityOption {
  id: string
  name: string
  type: string
  description?: string
}

const columns = [
  { key: 'trace_direction', label: 'Direction', sortable: true, type: 'badge' },
  { key: 'level_number', label: 'Level', sortable: true, numeric: true },
  { key: 'entity_type', label: 'Entity Type', sortable: true },
  { key: 'entity_name', label: 'Entity Name', sortable: true },
  { key: 'relationship_type', label: 'Relationship', sortable: true },
  { key: 'quantity', label: 'Quantity', sortable: true, numeric: true },
  { key: 'uom', label: 'Unit', sortable: true },
  { key: 'date_related', label: 'Date', sortable: true, type: 'date' },
  { key: 'risk_level', label: 'Risk Level', sortable: true, type: 'badge' }
]

export function RecallDrillReport() {
  const [traceData, setTraceData] = useState<RecallTraceItem[]>([])
  const [impactSummary, setImpactSummary] = useState<RecallImpactSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Entity selection
  const [selectedEntityType, setSelectedEntityType] = useState<string>('')
  const [selectedEntityId, setSelectedEntityId] = useState<string>('')
  const [traceDirection, setTraceDirection] = useState<string>('both')
  const [searchTerm, setSearchTerm] = useState('')
  const [entityOptions, setEntityOptions] = useState<EntityOption[]>([])
  const [searchingEntities, setSearchingEntities] = useState(false)

  const supabase = createClient()

  // Entity type options
  const entityTypes = [
    { value: 'item_lot', label: 'Ingredient Lot' },
    { value: 'batch', label: 'Batch' },
    { value: 'finished_lot', label: 'Finished Product Lot' },
    { value: 'shipment', label: 'Shipment' }
  ]

  // Search for entities when type changes or search term updates
  useEffect(() => {
    if (selectedEntityType) {
      searchEntities()
    }
  }, [selectedEntityType, searchTerm])

  const searchEntities = async () => {
    setSearchingEntities(true)
    setEntityOptions([])

    try {
      let query: any
      let nameField: string
      let descriptionField: string | null = null

      switch (selectedEntityType) {
        case 'item_lot':
          query = supabase
            .from('item_lots')
            .select('id, lot_code, items!inner(name)')
            .limit(20)
          nameField = 'lot_code'
          if (searchTerm) {
            query = query.or(`lot_code.ilike.%${searchTerm}%,items.name.ilike.%${searchTerm}%`)
          }
          break

        case 'batch':
          query = supabase
            .from('batches')
            .select('id, batch_number, recipes!inner(name)')
            .limit(20)
          nameField = 'batch_number'
          if (searchTerm) {
            query = query.or(`batch_number.ilike.%${searchTerm}%,recipes.name.ilike.%${searchTerm}%`)
          }
          break

        case 'finished_lot':
          query = supabase
            .from('finished_lots')
            .select('id, lot_code, finished_skus!inner(code)')
            .limit(20)
          nameField = 'lot_code'
          if (searchTerm) {
            query = query.or(`lot_code.ilike.%${searchTerm}%,finished_skus.code.ilike.%${searchTerm}%`)
          }
          break

        case 'shipment':
          query = supabase
            .from('removals')
            .select('id, doc_ref, reason')
            .limit(20)
          nameField = 'doc_ref'
          if (searchTerm) {
            query = query.ilike('doc_ref', `%${searchTerm}%`)
          }
          break

        default:
          setSearchingEntities(false)
          return
      }

      const { data, error } = await query

      if (error) throw error

      const options: EntityOption[] = (data || []).map((item: any) => {
        let name = item[nameField] || 'Unknown'
        let description = ''

        switch (selectedEntityType) {
          case 'item_lot':
            description = item.items?.name || ''
            break
          case 'batch':
            description = item.recipes?.name || ''
            break
          case 'finished_lot':
            description = item.finished_skus?.code || ''
            break
          case 'shipment':
            description = item.reason || ''
            break
        }

        return {
          id: item.id,
          name,
          type: selectedEntityType,
          description
        }
      })

      setEntityOptions(options)

    } catch (error: any) {
      console.error('Error searching entities:', error)
      setError(`Error searching ${selectedEntityType}: ${error.message}`)
    } finally {
      setSearchingEntities(false)
    }
  }

  const runRecallDrill = async () => {
    if (!selectedEntityType || !selectedEntityId) {
      setError('Please select an entity to trace')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { data, error } = await supabase.rpc('comprehensive_trace', {
        p_entity_type: selectedEntityType,
        p_entity_id: selectedEntityId,
        p_direction: traceDirection
      })

      if (error) throw error

      // Separate trace data and impact summary
      const traces = data.filter((item: any) => item.trace_data)
      const summary = data.find((item: any) => item.impact_summary)

      setTraceData(traces)
      setImpactSummary(summary?.impact_summary || null)

    } catch (err: any) {
      console.error('Error running recall drill:', err)
      setError(err.message)
      setTraceData([])
      setImpactSummary(null)
    } finally {
      setLoading(false)
    }
  }

  // Custom cell renderer
  const renderCell = (item: RecallTraceItem, column: any) => {
    switch (column.key) {
      case 'trace_direction':
        return (
          <Badge variant={item.trace_direction === 'upstream' ? 'default' : 'secondary'}>
            <div className="flex items-center space-x-1">
              {item.trace_direction === 'upstream' ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              <span>{item.trace_direction}</span>
            </div>
          </Badge>
        )

      case 'risk_level':
        const riskColors = {
          low: 'bg-green-50 text-green-700 border-green-200',
          medium: 'bg-yellow-50 text-yellow-700 border-yellow-200',
          high: 'bg-orange-50 text-orange-700 border-orange-200',
          critical: 'bg-red-50 text-red-700 border-red-200'
        }
        return (
          <Badge 
            variant="outline"
            className={riskColors[item.risk_level] || 'bg-gray-50 text-gray-700 border-gray-200'}
          >
            {item.risk_level.toUpperCase()}
          </Badge>
        )

      case 'quantity':
        return item.quantity ? `${item.quantity.toLocaleString()} ${item.uom || ''}`.trim() : '—'

      case 'date_related':
        return new Date(item.date_related).toLocaleDateString()

      default:
        return item[column.key as keyof RecallTraceItem] || '—'
    }
  }

  const canRunTrace = selectedEntityType && selectedEntityId

  return (
    <div className="space-y-6">
      {/* Entity Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Search className="h-5 w-5" />
            <span>Select Entity for Recall Drill</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Entity Type */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Entity Type</label>
              <Select 
                value={selectedEntityType} 
                onValueChange={(value) => {
                  setSelectedEntityType(value)
                  setSelectedEntityId('')
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  {entityTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Search */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Search</label>
              <Input
                placeholder="Search entities..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                disabled={!selectedEntityType}
              />
            </div>

            {/* Entity Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Entity</label>
              <Select 
                value={selectedEntityId} 
                onValueChange={setSelectedEntityId}
                disabled={!selectedEntityType}
              >
                <SelectTrigger>
                  <SelectValue placeholder={searchingEntities ? "Searching..." : "Select entity..."} />
                </SelectTrigger>
                <SelectContent>
                  {entityOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      <div>
                        <div className="font-medium">{option.name}</div>
                        {option.description && (
                          <div className="text-xs text-muted-foreground">{option.description}</div>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Direction */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Trace Direction</label>
              <Select value={traceDirection} onValueChange={setTraceDirection}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both (Upstream & Downstream)</SelectItem>
                  <SelectItem value="upstream">Upstream Only</SelectItem>
                  <SelectItem value="downstream">Downstream Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end space-x-2">
            <Button
              onClick={runRecallDrill}
              disabled={!canRunTrace || loading}
              className="flex items-center space-x-2"
            >
              <Search className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Running Trace...' : 'Run Recall Drill'}</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Impact Summary */}
      {impactSummary && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Upstream Items
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="flex items-center space-x-2">
                <TrendingUp className="h-4 w-4 text-blue-600" />
                <span className="text-2xl font-bold">{impactSummary.total_upstream_items}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Downstream Items
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="flex items-center space-x-2">
                <TrendingDown className="h-4 w-4 text-orange-600" />
                <span className="text-2xl font-bold">{impactSummary.total_downstream_items}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Affected Customers
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="flex items-center space-x-2">
                <Users className="h-4 w-4 text-red-600" />
                <span className="text-2xl font-bold">{impactSummary.affected_customers}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Risk Assessment
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <span className="text-2xl font-bold">{impactSummary.risk_assessment}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Controls */}
      {traceData.length > 0 && (
        <div className="flex justify-end">
          <ExportControls 
            reportType="recall_drill"
            entityType={selectedEntityType}
            entityId={selectedEntityId}
            direction={traceDirection}
          />
        </div>
      )}

      {/* Table */}
      {traceData.length > 0 && (
        <ReportTable
          data={traceData}
          columns={columns}
          loading={loading}
          error={error}
          renderCell={renderCell}
        />
      )}

      {/* No data message */}
      {!loading && traceData.length === 0 && !error && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <MapPin className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No Trace Results</h3>
              <p className="text-muted-foreground">
                Select an entity and run the recall drill to see traceability data.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}