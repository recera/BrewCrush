'use client'

import { useState, useEffect } from 'react'
import { useSupabase } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@brewcrush/ui/card'
import { Button } from '@brewcrush/ui/button'
import { Input } from '@brewcrush/ui/input'
import { Badge } from '@brewcrush/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@brewcrush/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@brewcrush/ui/table'
import { format } from 'date-fns'
import { Plus, Search, Eye, CheckCircle, Package, FileText, Edit, Ban, Copy, MoreVertical, Upload, Download } from 'lucide-react'
import { CreatePODialog } from './CreatePODialog'
import { ReceivePODialog } from './ReceivePODialog'
import { PODetailDialog } from './PODetailDialog'
import { EditPODialog } from './EditPODialog'
import { CancelPODialog } from './CancelPODialog'
import { POImportDialog } from './POImportDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@brewcrush/ui/dropdown-menu'
import { useUserRole } from '@/hooks/useUserRole'
import { toast } from '@brewcrush/ui'
import { trackEvent } from '@/lib/telemetry'

type POStatus = 'draft' | 'approved' | 'partial' | 'received' | 'closed' | 'cancelled'

interface PurchaseOrder {
  id: string
  po_number: string
  vendor: {
    id: string
    name: string
  }
  status: POStatus
  order_date: string
  due_date: string | null
  total: number | null
  created_by: {
    full_name: string | null
  }
  approved_by: {
    full_name: string | null
  } | null
  approved_at: string | null
  line_count?: number
  qty_received?: number
  qty_ordered?: number
}

const statusColors: Record<POStatus, string> = {
  draft: 'bg-gray-100 text-gray-800',
  approved: 'bg-blue-100 text-blue-800',
  partial: 'bg-yellow-100 text-yellow-800',
  received: 'bg-green-100 text-green-800',
  closed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-800',
}

const statusIcons: Record<POStatus, any> = {
  draft: FileText,
  approved: CheckCircle,
  partial: Package,
  received: Package,
  closed: FileText,
  cancelled: Ban,
}

export function POList() {
  const supabase = useSupabase()
  const { role } = useUserRole()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<POStatus | 'all'>('all')
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showReceiveDialog, setShowReceiveDialog] = useState(false)
  const [showDetailDialog, setShowDetailDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)

  const canCreate = role === 'admin' || role === 'inventory'
  const canApprove = role === 'admin' || role === 'accounting'
  const canReceive = role === 'admin' || role === 'inventory'

  useEffect(() => {
    fetchPurchaseOrders()
    
    // Set up real-time subscription
    const channel = supabase
      .channel('po-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'purchase_orders',
          filter: `workspace_id=eq.${localStorage.getItem('workspace_id')}`,
        },
        () => {
          fetchPurchaseOrders()
        }
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [])

  const fetchPurchaseOrders = async () => {
    try {
      setLoading(true)
      
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          id,
          po_number,
          status,
          order_date,
          due_date,
          total,
          vendor:vendors(id, name),
          created_by:users!purchase_orders_created_by_fkey(full_name),
          approved_by:users!purchase_orders_approved_by_fkey(full_name),
          approved_at,
          po_lines(
            id,
            qty,
            qty_received
          )
        `)
        .order('created_at', { ascending: false })

      if (error) throw error

      // Calculate line counts and quantities
      const ordersWithCounts = data?.map(po => ({
        ...po,
        line_count: po.po_lines?.length || 0,
        qty_ordered: po.po_lines?.reduce((sum: number, line: any) => sum + (line.qty || 0), 0) || 0,
        qty_received: po.po_lines?.reduce((sum: number, line: any) => sum + (line.qty_received || 0), 0) || 0,
      })) || []

      setOrders(ordersWithCounts)
    } catch (error) {
      console.error('Error fetching purchase orders:', error)
      toast.error('Failed to load purchase orders')
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (po: PurchaseOrder) => {
    try {
      const { error } = await supabase.rpc('approve_purchase_order', {
        p_po_id: po.id,
      })

      if (error) throw error

      // Track telemetry event
      await trackEvent('po_approved', {
        po_id: po.id,
        vendor_id: po.vendor.id,
        total: po.total,
      })

      toast.success(`PO ${po.po_number} approved successfully`)
      fetchPurchaseOrders()
    } catch (error) {
      console.error('Error approving PO:', error)
      toast.error('Failed to approve purchase order')
    }
  }

  const handleDuplicate = async (po: PurchaseOrder) => {
    try {
      const { data, error } = await supabase.rpc('duplicate_purchase_order', {
        p_po_id: po.id,
        p_new_due_date: null
      })

      if (error) throw error

      // Track telemetry event
      await trackEvent('po_duplicated', {
        original_po_id: po.id,
        new_po_id: data,
        vendor_id: po.vendor.id,
      })

      toast.success(`PO duplicated successfully`)
      fetchPurchaseOrders()
    } catch (error: any) {
      console.error('Error duplicating PO:', error)
      toast.error(error.message || 'Failed to duplicate purchase order')
    }
  }

  const filteredOrders = orders.filter(order => {
    const matchesSearch = 
      order.po_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.vendor.name.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter
    
    return matchesSearch && matchesStatus
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Purchase Orders</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const response = await fetch('/api/po/export?format=csv')
                if (response.ok) {
                  const blob = await response.blob()
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `purchase_orders_${new Date().toISOString().split('T')[0]}.csv`
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                  toast.success('Purchase orders exported successfully')
                } else {
                  toast.error('Failed to export purchase orders')
                }
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
            {canCreate && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowImportDialog(true)}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Import
                </Button>
                <Button onClick={() => setShowCreateDialog(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  New PO
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4 mb-6">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search by PO number or vendor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as POStatus | 'all')}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="received">Received</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO Number</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No purchase orders found
                  </TableCell>
                </TableRow>
              ) : (
                filteredOrders.map((order) => {
                  const StatusIcon = statusIcons[order.status]
                  const progress = order.qty_ordered > 0 
                    ? Math.round((order.qty_received / order.qty_ordered) * 100) 
                    : 0

                  return (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.po_number}</TableCell>
                      <TableCell>{order.vendor.name}</TableCell>
                      <TableCell>
                        <Badge className={statusColors[order.status]}>
                          <StatusIcon className="mr-1 h-3 w-3" />
                          {order.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{format(new Date(order.order_date), 'MMM d, yyyy')}</TableCell>
                      <TableCell>
                        {order.due_date ? format(new Date(order.due_date), 'MMM d, yyyy') : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {order.total ? `$${order.total.toFixed(2)}` : '-'}
                      </TableCell>
                      <TableCell>
                        {order.status !== 'draft' && (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                              <div 
                                className="bg-green-500 h-2 rounded-full transition-all"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">{progress}%</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedPO(order)
                              setShowDetailDialog(true)
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {order.status === 'draft' && canApprove && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleApprove(order)}
                            >
                              <CheckCircle className="h-4 w-4 text-blue-600" />
                            </Button>
                          )}
                          {(order.status === 'approved' || order.status === 'partial') && canReceive && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedPO(order)
                                setShowReceiveDialog(true)
                              }}
                            >
                              <Package className="h-4 w-4 text-green-600" />
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {order.status === 'draft' && canCreate && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedPO(order)
                                    setShowEditDialog(true)
                                  }}
                                >
                                  <Edit className="mr-2 h-4 w-4" />
                                  Edit PO
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => handleDuplicate(order)}
                              >
                                <Copy className="mr-2 h-4 w-4" />
                                Duplicate PO
                              </DropdownMenuItem>
                              {order.status !== 'closed' && order.status !== 'cancelled' && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => {
                                      setSelectedPO(order)
                                      setShowCancelDialog(true)
                                    }}
                                  >
                                    <Ban className="mr-2 h-4 w-4" />
                                    Cancel PO
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {showCreateDialog && (
          <CreatePODialog
            open={showCreateDialog}
            onOpenChange={setShowCreateDialog}
            onSuccess={() => {
              fetchPurchaseOrders()
              setShowCreateDialog(false)
            }}
          />
        )}

        {showReceiveDialog && selectedPO && (
          <ReceivePODialog
            open={showReceiveDialog}
            onOpenChange={setShowReceiveDialog}
            purchaseOrder={selectedPO}
            onSuccess={() => {
              fetchPurchaseOrders()
              setShowReceiveDialog(false)
            }}
          />
        )}

        {showDetailDialog && selectedPO && (
          <PODetailDialog
            open={showDetailDialog}
            onOpenChange={setShowDetailDialog}
            purchaseOrder={selectedPO}
          />
        )}

        {showEditDialog && selectedPO && (
          <EditPODialog
            po={selectedPO}
            isOpen={showEditDialog}
            onClose={() => setShowEditDialog(false)}
            onSuccess={() => {
              fetchPurchaseOrders()
              setShowEditDialog(false)
            }}
          />
        )}

        {showCancelDialog && selectedPO && (
          <CancelPODialog
            po={selectedPO}
            isOpen={showCancelDialog}
            onClose={() => setShowCancelDialog(false)}
            onSuccess={() => {
              fetchPurchaseOrders()
              setShowCancelDialog(false)
            }}
          />
        )}

        {showImportDialog && (
          <POImportDialog
            isOpen={showImportDialog}
            onClose={() => setShowImportDialog(false)}
            onSuccess={() => {
              fetchPurchaseOrders()
              setShowImportDialog(false)
            }}
          />
        )}
      </CardContent>
    </Card>
  )
}