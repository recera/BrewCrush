'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui/card'
import { Button } from '@brewcrush/ui/button'
import { Input } from '@brewcrush/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@brewcrush/ui/select'
import { Badge } from '@brewcrush/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@brewcrush/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@brewcrush/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@brewcrush/ui/alert'
import { 
  Plus, 
  Search, 
  Filter, 
  Download, 
  Upload, 
  Package,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  DollarSign,
  MapPin,
  BarChart3
} from 'lucide-react'
import { ItemDetailDialog } from './item-detail-dialog'
import { NewItemDialog } from './new-item-dialog'
import { AdjustInventoryDialog } from './adjust-inventory-dialog'
import { TransferInventoryDialog } from './transfer-inventory-dialog'

interface InventoryCatalogProps {
  inventoryData: any[]
  locations: any[]
  lowStockItems: any[]
  userRole: string
}

export function InventoryCatalog({ 
  inventoryData, 
  locations, 
  lowStockItems,
  userRole 
}: InventoryCatalogProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedType, setSelectedType] = useState('all')
  const [selectedLocation, setSelectedLocation] = useState('all')
  const [selectedItem, setSelectedItem] = useState<any>(null)
  const [showNewItemDialog, setShowNewItemDialog] = useState(false)
  const [showAdjustDialog, setShowAdjustDialog] = useState(false)
  const [showTransferDialog, setShowTransferDialog] = useState(false)

  // Filter inventory data
  const filteredInventory = inventoryData.filter(item => {
    const matchesSearch = item.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.sku?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesType = selectedType === 'all' || item.item_type === selectedType
    const matchesLocation = selectedLocation === 'all' || item.location_id === selectedLocation
    return matchesSearch && matchesType && matchesLocation
  })

  // Calculate summary statistics
  const totalValue = inventoryData.reduce((sum, item) => 
    sum + (item.qty_on_hand * (item.avg_unit_cost || 0)), 0
  )
  const totalItems = new Set(inventoryData.map(item => item.item_id)).size
  const totalLocations = new Set(inventoryData.map(item => item.location_id)).size

  // Check if user can see costs
  const canSeeCosts = userRole === 'admin' || userRole === 'inventory' || userRole === 'accounting'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground">
            Manage raw materials, packaging, and finished goods
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          {(userRole === 'admin' || userRole === 'inventory') && (
            <Button size="sm" onClick={() => setShowNewItemDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Item
            </Button>
          )}
        </div>
      </div>

      {/* Low Stock Alert */}
      {lowStockItems.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Low Stock Alert</AlertTitle>
          <AlertDescription>
            {lowStockItems.length} items are below their reorder level.
            <Button variant="link" size="sm" className="px-2">
              View items
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Items</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalItems}</div>
            <p className="text-xs text-muted-foreground">
              Across all locations
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Locations</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalLocations}</div>
            <p className="text-xs text-muted-foreground">
              Active locations
            </p>
          </CardContent>
        </Card>

        {canSeeCosts && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Value</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground">
                Current inventory value
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{lowStockItems.length}</div>
            <p className="text-xs text-muted-foreground">
              Items need reordering
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or SKU..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="raw">Raw Materials</SelectItem>
                  <SelectItem value="packaging">Packaging</SelectItem>
                  <SelectItem value="finished">Finished Goods</SelectItem>
                  <SelectItem value="misc">Miscellaneous</SelectItem>
                </SelectContent>
              </Select>

              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map(location => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Inventory Table */}
      <Card>
        <CardContent className="p-0">
          <Tabs defaultValue="on-hand" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="on-hand">On Hand</TabsTrigger>
              <TabsTrigger value="low-stock">Low Stock</TabsTrigger>
              <TabsTrigger value="transactions">Recent Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="on-hand" className="mt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">On Hand</TableHead>
                    <TableHead className="text-right">Lots</TableHead>
                    {canSeeCosts && (
                      <>
                        <TableHead className="text-right">Avg Cost</TableHead>
                        <TableHead className="text-right">Total Value</TableHead>
                      </>
                    )}
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInventory.map((item) => (
                    <TableRow key={`${item.item_id}-${item.location_id}`}>
                      <TableCell className="font-medium">
                        <button
                          className="text-left hover:underline"
                          onClick={() => setSelectedItem(item)}
                        >
                          {item.item_name}
                        </button>
                      </TableCell>
                      <TableCell>{item.sku || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {item.item_type}
                        </Badge>
                      </TableCell>
                      <TableCell>{item.location_name}</TableCell>
                      <TableCell className="text-right">
                        {item.qty_on_hand} {item.primary_uom}
                      </TableCell>
                      <TableCell className="text-right">{item.lot_count}</TableCell>
                      {canSeeCosts && (
                        <>
                          <TableCell className="text-right">
                            ${item.avg_unit_cost?.toFixed(2) || '0.00'}
                          </TableCell>
                          <TableCell className="text-right">
                            ${(item.qty_on_hand * (item.avg_unit_cost || 0)).toFixed(2)}
                          </TableCell>
                        </>
                      )}
                      <TableCell>
                        {item.next_expiry && (
                          <Badge variant="secondary" className="text-xs">
                            Exp: {new Date(item.next_expiry).toLocaleDateString()}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {(userRole === 'admin' || userRole === 'inventory') && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedItem(item)
                                  setShowAdjustDialog(true)
                                }}
                              >
                                Adjust
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedItem(item)
                                  setShowTransferDialog(true)
                                }}
                              >
                                Transfer
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="low-stock" className="p-4">
              <div className="text-center text-muted-foreground py-8">
                Low stock items will be displayed here
              </div>
            </TabsContent>

            <TabsContent value="transactions" className="p-4">
              <div className="text-center text-muted-foreground py-8">
                Recent inventory transactions will be displayed here
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Dialogs */}
      {selectedItem && !showAdjustDialog && !showTransferDialog && (
        <ItemDetailDialog
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          canSeeCosts={canSeeCosts}
        />
      )}

      {showNewItemDialog && (
        <NewItemDialog
          onClose={() => setShowNewItemDialog(false)}
          onSuccess={() => {
            setShowNewItemDialog(false)
            // TODO: Refresh inventory data
          }}
        />
      )}

      {showAdjustDialog && selectedItem && (
        <AdjustInventoryDialog
          item={selectedItem}
          locations={locations}
          onClose={() => {
            setShowAdjustDialog(false)
            setSelectedItem(null)
          }}
          onSuccess={() => {
            setShowAdjustDialog(false)
            setSelectedItem(null)
            // TODO: Refresh inventory data
          }}
        />
      )}

      {showTransferDialog && selectedItem && (
        <TransferInventoryDialog
          item={selectedItem}
          locations={locations}
          onClose={() => {
            setShowTransferDialog(false)
            setSelectedItem(null)
          }}
          onSuccess={() => {
            setShowTransferDialog(false)
            setSelectedItem(null)
            // TODO: Refresh inventory data
          }}
        />
      )}
    </div>
  )
}