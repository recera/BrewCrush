'use client'

import { useState, useEffect } from 'react'
import { useSupabase } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui/card'
import { Button } from '@brewcrush/ui/button'
import { Badge } from '@brewcrush/ui/badge'
import { Checkbox } from '@brewcrush/ui/checkbox'
import { Alert, AlertDescription } from '@brewcrush/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@brewcrush/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@brewcrush/ui/select'
import { AlertTriangle, Package, TrendingDown, ShoppingCart, Clock } from 'lucide-react'
import { CreatePODialog } from './CreatePODialog'
import { toast } from '@brewcrush/ui'

interface LowStockItem {
  item_id: string
  item_name: string
  sku: string | null
  vendor_id: string | null
  vendor_name: string | null
  current_qty: number
  reorder_level: number
  reorder_qty: number
  last_unit_cost: number | null
  estimated_value: number | null
  days_until_stockout: number | null
}

interface VendorGroup {
  vendor_id: string
  vendor_name: string
  items: LowStockItem[]
  total_value: number
}

export function LowStockReorder() {
  const supabase = useSupabase()
  const [loading, setLoading] = useState(true)
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([])
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [selectedVendor, setSelectedVendor] = useState<string>('all')
  const [showCreatePO, setShowCreatePO] = useState(false)
  const [createPOVendor, setCreatePOVendor] = useState<string>('')
  const [createPOItems, setCreatePOItems] = useState<string[]>([])

  useEffect(() => {
    fetchLowStockItems()
  }, [])

  const fetchLowStockItems = async () => {
    try {
      setLoading(true)
      
      const { data, error } = await supabase.rpc('get_low_stock_reorder_suggestions')

      if (error) throw error

      setLowStockItems(data || [])
    } catch (error) {
      console.error('Error fetching low stock items:', error)
      toast.error('Failed to load low stock items')
    } finally {
      setLoading(false)
    }
  }

  const groupByVendor = (): VendorGroup[] => {
    const groups: Record<string, VendorGroup> = {}
    
    lowStockItems.forEach(item => {
      const vendorId = item.vendor_id || 'no-vendor'
      const vendorName = item.vendor_name || 'No Vendor Assigned'
      
      if (!groups[vendorId]) {
        groups[vendorId] = {
          vendor_id: vendorId,
          vendor_name: vendorName,
          items: [],
          total_value: 0
        }
      }
      
      groups[vendorId].items.push(item)
      groups[vendorId].total_value += item.estimated_value || 0
    })
    
    return Object.values(groups).sort((a, b) => b.total_value - a.total_value)
  }

  const handleSelectAll = (vendorId: string) => {
    const vendorItems = lowStockItems.filter(item => 
      (item.vendor_id || 'no-vendor') === vendorId
    )
    
    const newSelected = new Set(selectedItems)
    const allSelected = vendorItems.every(item => selectedItems.has(item.item_id))
    
    if (allSelected) {
      vendorItems.forEach(item => newSelected.delete(item.item_id))
    } else {
      vendorItems.forEach(item => newSelected.add(item.item_id))
    }
    
    setSelectedItems(newSelected)
  }

  const handleItemToggle = (itemId: string) => {
    const newSelected = new Set(selectedItems)
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId)
    } else {
      newSelected.add(itemId)
    }
    setSelectedItems(newSelected)
  }

  const handleCreatePOForVendor = (vendorId: string) => {
    if (vendorId === 'no-vendor') {
      toast.error('Cannot create PO for items without vendor')
      return
    }
    
    const vendorItems = lowStockItems
      .filter(item => item.vendor_id === vendorId && selectedItems.has(item.item_id))
      .map(item => item.item_id)
    
    if (vendorItems.length === 0) {
      toast.error('Please select items to add to PO')
      return
    }
    
    setCreatePOVendor(vendorId)
    setCreatePOItems(vendorItems)
    setShowCreatePO(true)
  }

  const handleAutoCreatePO = async (vendorId: string) => {
    if (vendorId === 'no-vendor') {
      toast.error('Cannot create PO for items without vendor')
      return
    }

    try {
      const vendorItems = lowStockItems
        .filter(item => item.vendor_id === vendorId)
        .map(item => item.item_id)

      const { data, error } = await supabase.rpc('create_po_from_reorder_suggestions', {
        p_vendor_id: vendorId,
        p_item_ids: vendorItems,
        p_due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      })

      if (error) throw error

      toast.success('Purchase order created successfully')
      fetchLowStockItems()
    } catch (error) {
      console.error('Error creating PO:', error)
      toast.error('Failed to create purchase order')
    }
  }

  const filteredItems = selectedVendor === 'all' 
    ? lowStockItems
    : lowStockItems.filter(item => (item.vendor_id || 'no-vendor') === selectedVendor)

  const vendorGroups = groupByVendor()
  const criticalCount = lowStockItems.filter(item => 
    item.days_until_stockout !== null && item.days_until_stockout <= 7
  ).length

  const getSeverityColor = (days: number | null) => {
    if (days === null) return 'text-gray-500'
    if (days <= 3) return 'text-red-600'
    if (days <= 7) return 'text-orange-600'
    if (days <= 14) return 'text-yellow-600'
    return 'text-gray-600'
  }

  const getSeverityBadge = (days: number | null) => {
    if (days === null) return null
    if (days <= 3) return <Badge variant="destructive">Critical</Badge>
    if (days <= 7) return <Badge className="bg-orange-100 text-orange-800">Urgent</Badge>
    if (days <= 14) return <Badge className="bg-yellow-100 text-yellow-800">Warning</Badge>
    return null
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Low Stock & Reorder Suggestions</CardTitle>
              <CardDescription>
                {lowStockItems.length} items below reorder level
                {criticalCount > 0 && (
                  <span className="ml-2 text-red-600">
                    ({criticalCount} critical)
                  </span>
                )}
              </CardDescription>
            </div>
            <Select value={selectedVendor} onValueChange={setSelectedVendor}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All vendors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All vendors</SelectItem>
                {vendorGroups.map(group => (
                  <SelectItem key={group.vendor_id} value={group.vendor_id}>
                    {group.vendor_name} ({group.items.length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {criticalCount > 0 && (
            <Alert className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>{criticalCount} items</strong> are critically low and may run out within 7 days based on recent consumption.
              </AlertDescription>
            </Alert>
          )}

          {selectedVendor === 'all' ? (
            // Grouped by vendor view
            <div className="space-y-4">
              {vendorGroups.map(group => (
                <Card key={group.vendor_id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={group.items.every(item => selectedItems.has(item.item_id))}
                          onCheckedChange={() => handleSelectAll(group.vendor_id)}
                        />
                        <CardTitle className="text-base">
                          {group.vendor_name}
                        </CardTitle>
                        <Badge variant="outline">
                          {group.items.length} items
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          Est. value: ${group.total_value.toFixed(2)}
                        </span>
                        {group.vendor_id !== 'no-vendor' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCreatePOForVendor(group.vendor_id)}
                              disabled={!group.items.some(item => selectedItems.has(item.item_id))}
                            >
                              <ShoppingCart className="mr-2 h-4 w-4" />
                              Create PO (Selected)
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleAutoCreatePO(group.vendor_id)}
                            >
                              Auto-Generate PO
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[40px]"></TableHead>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Current</TableHead>
                          <TableHead className="text-right">Reorder At</TableHead>
                          <TableHead className="text-right">Reorder Qty</TableHead>
                          <TableHead className="text-right">Unit Cost</TableHead>
                          <TableHead className="text-right">Est. Value</TableHead>
                          <TableHead>Days Left</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.items.map(item => (
                          <TableRow key={item.item_id}>
                            <TableCell>
                              <Checkbox
                                checked={selectedItems.has(item.item_id)}
                                onCheckedChange={() => handleItemToggle(item.item_id)}
                              />
                            </TableCell>
                            <TableCell>
                              <div>
                                <div className="font-medium">{item.item_name}</div>
                                {item.sku && (
                                  <div className="text-xs text-muted-foreground">{item.sku}</div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={item.current_qty === 0 ? 'text-red-600 font-medium' : ''}>
                                {item.current_qty.toFixed(2)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              {item.reorder_level.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.reorder_qty.toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.last_unit_cost ? `$${item.last_unit_cost.toFixed(2)}` : '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.estimated_value ? `$${item.estimated_value.toFixed(2)}` : '-'}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {item.days_until_stockout !== null ? (
                                  <>
                                    <Clock className={`h-4 w-4 ${getSeverityColor(item.days_until_stockout)}`} />
                                    <span className={getSeverityColor(item.days_until_stockout)}>
                                      {item.days_until_stockout}d
                                    </span>
                                    {getSeverityBadge(item.days_until_stockout)}
                                  </>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            // Single vendor view
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={filteredItems.every(item => selectedItems.has(item.item_id))}
                      onCheckedChange={() => handleSelectAll(selectedVendor)}
                    />
                  </TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Current Stock</TableHead>
                  <TableHead className="text-right">Reorder Level</TableHead>
                  <TableHead className="text-right">Reorder Qty</TableHead>
                  <TableHead className="text-right">Last Cost</TableHead>
                  <TableHead className="text-right">Est. Value</TableHead>
                  <TableHead>Days Until Stockout</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No low stock items found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredItems.map(item => (
                    <TableRow key={item.item_id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedItems.has(item.item_id)}
                          onCheckedChange={() => handleItemToggle(item.item_id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{item.item_name}</div>
                          {item.sku && (
                            <div className="text-xs text-muted-foreground">{item.sku}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {item.current_qty < item.reorder_level * 0.5 && (
                            <TrendingDown className="h-4 w-4 text-red-500" />
                          )}
                          <span className={item.current_qty === 0 ? 'text-red-600 font-medium' : ''}>
                            {item.current_qty.toFixed(2)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {item.reorder_level.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {item.reorder_qty.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.last_unit_cost ? `$${item.last_unit_cost.toFixed(2)}` : '-'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {item.estimated_value ? `$${item.estimated_value.toFixed(2)}` : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {item.days_until_stockout !== null ? (
                            <>
                              <Clock className={`h-4 w-4 ${getSeverityColor(item.days_until_stockout)}`} />
                              <span className={`font-medium ${getSeverityColor(item.days_until_stockout)}`}>
                                {item.days_until_stockout} days
                              </span>
                              {getSeverityBadge(item.days_until_stockout)}
                            </>
                          ) : (
                            <span className="text-muted-foreground">No recent usage</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}

          {selectedVendor !== 'all' && selectedVendor !== 'no-vendor' && filteredItems.length > 0 && (
            <div className="flex justify-end mt-4 gap-2">
              <Button
                variant="outline"
                onClick={() => handleCreatePOForVendor(selectedVendor)}
                disabled={!filteredItems.some(item => selectedItems.has(item.item_id))}
              >
                <ShoppingCart className="mr-2 h-4 w-4" />
                Create PO from Selected ({selectedItems.size})
              </Button>
              <Button onClick={() => handleAutoCreatePO(selectedVendor)}>
                <Package className="mr-2 h-4 w-4" />
                Auto-Generate PO for All
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {showCreatePO && (
        <CreatePODialog
          open={showCreatePO}
          onOpenChange={setShowCreatePO}
          onSuccess={() => {
            setShowCreatePO(false)
            fetchLowStockItems()
            setSelectedItems(new Set())
          }}
          vendorId={createPOVendor}
          suggestedItems={createPOItems}
        />
      )}
    </>
  )
}