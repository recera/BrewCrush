'use client'

import { useState, useEffect } from 'react'
import { useSupabase } from '@/lib/supabase/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@brewcrush/ui/dialog'
import { Button } from '@brewcrush/ui/button'
import { Badge } from '@brewcrush/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@brewcrush/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@brewcrush/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@brewcrush/ui/card'
import { format } from 'date-fns'
import { FileText, Package, TrendingUp, TrendingDown, Clock, CheckCircle, AlertTriangle, Download } from 'lucide-react'
import { cn } from '@brewcrush/ui/lib/utils'
import { toast } from '@brewcrush/ui'

interface PurchaseOrder {
  id: string
  po_number: string
  vendor: {
    id: string
    name: string
  }
  status: string
}

interface PODetail {
  id: string
  po_number: string
  vendor: {
    name: string
    email: string | null
    phone: string | null
    address: string | null
  }
  status: string
  order_date: string
  due_date: string | null
  terms: string | null
  notes: string | null
  subtotal: number | null
  tax: number | null
  total: number | null
  created_by: {
    full_name: string | null
  }
  approved_by: {
    full_name: string | null
  } | null
  approved_at: string | null
  po_lines: POLine[]
  po_receipts: POReceipt[]
}

interface POLine {
  id: string
  item: {
    name: string
    sku: string | null
  }
  qty: number
  uom: string
  expected_unit_cost: number
  location: {
    name: string
  }
  qty_received: number | null
  notes: string | null
}

interface POReceipt {
  id: string
  receipt_number: string
  received_at: string
  received_by: {
    full_name: string | null
  }
  notes: string | null
  po_receipt_lines: ReceiptLine[]
}

interface ReceiptLine {
  id: string
  po_line_id: string
  qty_received: number
  unit_cost: number
  lot_code: string
  expiry: string | null
}

interface PODetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  purchaseOrder: PurchaseOrder
}

export function PODetailDialog({ 
  open, 
  onOpenChange, 
  purchaseOrder
}: PODetailDialogProps) {
  const supabase = useSupabase()
  const [detail, setDetail] = useState<PODetail | null>(null)
  const [variance, setVariance] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (open && purchaseOrder) {
      fetchPODetail()
      fetchVariance()
    }
  }, [open, purchaseOrder])

  const fetchPODetail = async () => {
    try {
      setLoading(true)
      
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          *,
          vendor:vendors(*),
          created_by:users!purchase_orders_created_by_fkey(full_name),
          approved_by:users!purchase_orders_approved_by_fkey(full_name),
          po_lines(
            *,
            item:items(name, sku),
            location:inventory_locations(name)
          ),
          po_receipts(
            *,
            received_by:users!po_receipts_received_by_fkey(full_name),
            po_receipt_lines(*)
          )
        `)
        .eq('id', purchaseOrder.id)
        .single()

      if (error) throw error

      setDetail(data)
    } catch (error) {
      console.error('Error fetching PO detail:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchVariance = async () => {
    try {
      const { data, error } = await supabase.rpc('get_po_variance_analysis', {
        p_po_id: purchaseOrder.id
      })

      if (!error && data) {
        setVariance(data)
      }
    } catch (error) {
      console.error('Error fetching variance:', error)
    }
  }

  if (loading || !detail) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const totalOrdered = detail.po_lines.reduce((sum, line) => sum + line.qty, 0)
  const totalReceived = detail.po_lines.reduce((sum, line) => sum + (line.qty_received || 0), 0)
  const completionRate = totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 0

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    approved: 'bg-blue-100 text-blue-800',
    partial: 'bg-yellow-100 text-yellow-800',
    received: 'bg-green-100 text-green-800',
    closed: 'bg-gray-100 text-gray-600',
  }

  const statusIcons: Record<string, any> = {
    draft: FileText,
    approved: CheckCircle,
    partial: Package,
    received: Package,
    closed: FileText,
  }

  const StatusIcon = statusIcons[detail.status] || FileText

  const handleDownloadPDF = async () => {
    try {
      const response = await fetch(`/api/po/${detail.id}/pdf`)
      
      if (!response.ok) {
        throw new Error('Failed to download PDF')
      }
      
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `PO_${detail.po_number}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      toast.success('PDF downloaded successfully')
    } catch (error) {
      console.error('Error downloading PDF:', error)
      toast.error('Failed to download PDF')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                Purchase Order {detail.po_number}
                <Badge className={statusColors[detail.status]}>
                  <StatusIcon className="mr-1 h-3 w-3" />
                  {detail.status}
                </Badge>
              </DialogTitle>
              <DialogDescription>
                {detail.vendor.name} • Ordered {format(new Date(detail.order_date), 'MMM d, yyyy')}
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPDF}
            >
              <Download className="mr-2 h-4 w-4" />
              Download PDF
            </Button>
          </div>
        </DialogHeader>

        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="items">Items</TabsTrigger>
            <TabsTrigger value="receipts">Receipts</TabsTrigger>
            <TabsTrigger value="variance">Variance</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Vendor Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div>
                    <div className="text-sm text-muted-foreground">Name</div>
                    <div className="font-medium">{detail.vendor.name}</div>
                  </div>
                  {detail.vendor.email && (
                    <div>
                      <div className="text-sm text-muted-foreground">Email</div>
                      <div>{detail.vendor.email}</div>
                    </div>
                  )}
                  {detail.vendor.phone && (
                    <div>
                      <div className="text-sm text-muted-foreground">Phone</div>
                      <div>{detail.vendor.phone}</div>
                    </div>
                  )}
                  {detail.vendor.address && (
                    <div>
                      <div className="text-sm text-muted-foreground">Address</div>
                      <div className="text-sm">{detail.vendor.address}</div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Order Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-sm text-muted-foreground">Order Date</div>
                      <div className="font-medium">
                        {format(new Date(detail.order_date), 'MMM d, yyyy')}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Due Date</div>
                      <div className="font-medium">
                        {detail.due_date 
                          ? format(new Date(detail.due_date), 'MMM d, yyyy')
                          : '-'
                        }
                      </div>
                    </div>
                  </div>
                  {detail.terms && (
                    <div>
                      <div className="text-sm text-muted-foreground">Payment Terms</div>
                      <div>{detail.terms}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-sm text-muted-foreground">Created By</div>
                    <div>{detail.created_by.full_name || 'Unknown'}</div>
                  </div>
                  {detail.approved_by && (
                    <div>
                      <div className="text-sm text-muted-foreground">Approved By</div>
                      <div>
                        {detail.approved_by.full_name || 'Unknown'}
                        {detail.approved_at && (
                          <span className="text-sm text-muted-foreground ml-2">
                            on {format(new Date(detail.approved_at), 'MMM d, yyyy')}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Fulfillment Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Completion</span>
                    <span className="font-medium">{completionRate.toFixed(1)}%</span>
                  </div>
                  <div className="bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${completionRate}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>{totalReceived} received</span>
                    <span>{totalOrdered} ordered</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {detail.notes && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">{detail.notes}</p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Order Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Subtotal</span>
                    <span className="font-medium">
                      ${detail.subtotal?.toFixed(2) || '0.00'}
                    </span>
                  </div>
                  {detail.tax && detail.tax > 0 && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Tax</span>
                      <span className="font-medium">
                        ${detail.tax.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t">
                    <span className="font-medium">Total</span>
                    <span className="text-xl font-bold">
                      ${detail.total?.toFixed(2) || '0.00'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="items">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.po_lines.map((line) => {
                  const received = line.qty_received || 0
                  const isComplete = received >= line.qty
                  const isPartial = received > 0 && received < line.qty
                  
                  return (
                    <TableRow key={line.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{line.item.name}</div>
                          {line.item.sku && (
                            <div className="text-xs text-muted-foreground">{line.item.sku}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{line.location.name}</TableCell>
                      <TableCell className="text-right">
                        {line.qty} {line.uom}
                      </TableCell>
                      <TableCell className="text-right">
                        {received} {line.uom}
                      </TableCell>
                      <TableCell className="text-right">
                        ${line.expected_unit_cost.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        ${(line.qty * line.expected_unit_cost).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {isComplete && (
                          <Badge className="bg-green-100 text-green-800">
                            <CheckCircle className="mr-1 h-3 w-3" />
                            Complete
                          </Badge>
                        )}
                        {isPartial && (
                          <Badge className="bg-yellow-100 text-yellow-800">
                            <Clock className="mr-1 h-3 w-3" />
                            Partial
                          </Badge>
                        )}
                        {!isComplete && !isPartial && (
                          <Badge variant="outline">Pending</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TabsContent>

          <TabsContent value="receipts">
            {detail.po_receipts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No receipts recorded yet
              </div>
            ) : (
              <div className="space-y-4">
                {detail.po_receipts.map((receipt) => (
                  <Card key={receipt.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">
                          Receipt {receipt.receipt_number}
                        </CardTitle>
                        <div className="text-sm text-muted-foreground">
                          {format(new Date(receipt.received_at), 'MMM d, yyyy h:mm a')}
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Received by {receipt.received_by?.full_name || 'Unknown'}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead>Qty Received</TableHead>
                            <TableHead>Unit Cost</TableHead>
                            <TableHead>Lot Code</TableHead>
                            <TableHead>Expiry</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {receipt.po_receipt_lines.map((line) => {
                            const poLine = detail.po_lines.find(pl => pl.id === line.po_line_id)
                            return (
                              <TableRow key={line.id}>
                                <TableCell>{poLine?.item.name || 'Unknown'}</TableCell>
                                <TableCell>
                                  {line.qty_received} {poLine?.uom}
                                </TableCell>
                                <TableCell>${line.unit_cost.toFixed(2)}</TableCell>
                                <TableCell>{line.lot_code}</TableCell>
                                <TableCell>
                                  {line.expiry 
                                    ? format(new Date(line.expiry), 'MMM d, yyyy')
                                    : '-'
                                  }
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                      {receipt.notes && (
                        <div className="mt-4 p-3 bg-gray-50 rounded-md">
                          <div className="text-sm font-medium mb-1">Notes</div>
                          <div className="text-sm text-muted-foreground">
                            {receipt.notes}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="variance">
            {!variance || variance.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No variance data available
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Qty Variance</TableHead>
                    <TableHead className="text-right">Expected Cost</TableHead>
                    <TableHead className="text-right">Actual Avg Cost</TableHead>
                    <TableHead className="text-right">Cost Variance</TableHead>
                    <TableHead className="text-right">Value Impact</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variance.map((item: any) => (
                    <TableRow key={item.po_line_id}>
                      <TableCell className="font-medium">{item.item_name}</TableCell>
                      <TableCell className="text-right">{item.ordered_qty}</TableCell>
                      <TableCell className="text-right">{item.received_qty}</TableCell>
                      <TableCell className="text-right">
                        {item.qty_variance !== 0 && (
                          <Badge variant={item.qty_variance < 0 ? "destructive" : "outline"}>
                            {item.qty_variance}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        ${item.expected_cost?.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        ${item.actual_avg_cost?.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {Math.abs(item.cost_variance_pct) > 5 && (
                          <Badge 
                            variant={item.cost_variance_pct > 0 ? "destructive" : "success"}
                            className="gap-1"
                          >
                            {item.cost_variance_pct > 0 ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3" />
                            )}
                            {Math.abs(item.cost_variance_pct).toFixed(1)}%
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className={cn(
                        "text-right font-medium",
                        item.total_value_variance > 0 ? "text-red-600" : item.total_value_variance < 0 ? "text-green-600" : ""
                      )}>
                        {item.total_value_variance !== 0 && (
                          <>
                            {item.total_value_variance > 0 ? '+' : ''}
                            ${Math.abs(item.total_value_variance).toFixed(2)}
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}