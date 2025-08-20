'use client'

import { useState, useEffect } from 'react'
import { useSupabase } from '@/lib/supabase/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@brewcrush/ui/dialog'
import { Button } from '@brewcrush/ui/button'
import { Input } from '@brewcrush/ui/input'
import { Label } from '@brewcrush/ui/label'
import { Textarea } from '@brewcrush/ui/textarea'
import { Alert, AlertDescription } from '@brewcrush/ui/alert'
import { Badge } from '@brewcrush/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@brewcrush/ui/table'
import { Calendar } from '@brewcrush/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@brewcrush/ui/popover'
import { format } from 'date-fns'
import { CalendarIcon, AlertTriangle, TrendingUp, TrendingDown, Package } from 'lucide-react'
import { cn } from '@brewcrush/ui/lib/utils'
import { toast } from '@brewcrush/ui'
import { trackEvent } from '@/lib/telemetry'

interface PurchaseOrder {
  id: string
  po_number: string
  vendor: {
    id: string
    name: string
  }
  status: string
}

interface POLine {
  id: string
  item_id: string
  item: {
    name: string
    sku: string | null
  }
  qty: number
  uom: string
  expected_unit_cost: number
  location_id: string
  location: {
    name: string
  }
  qty_received: number | null
}

interface ReceiptLine {
  po_line_id: string
  qty_received: number
  unit_cost: number
  lot_code: string
  expiry?: Date
  location_id: string
  has_variance: boolean
  variance_pct: number
}

interface ReceivePODialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  purchaseOrder: PurchaseOrder
  onSuccess: () => void
}

export function ReceivePODialog({ 
  open, 
  onOpenChange, 
  purchaseOrder,
  onSuccess
}: ReceivePODialogProps) {
  const supabase = useSupabase()
  const [loading, setLoading] = useState(false)
  const [poLines, setPOLines] = useState<POLine[]>([])
  const [receiptLines, setReceiptLines] = useState<ReceiptLine[]>([])
  const [notes, setNotes] = useState('')
  const [totalVariance, setTotalVariance] = useState(0)
  const [hasSignificantVariance, setHasSignificantVariance] = useState(false)

  useEffect(() => {
    if (open && purchaseOrder) {
      fetchPOLines()
    }
  }, [open, purchaseOrder])

  const fetchPOLines = async () => {
    const { data, error } = await supabase
      .from('po_lines')
      .select(`
        id,
        item_id,
        item:items(name, sku),
        qty,
        uom,
        expected_unit_cost,
        location_id,
        location:inventory_locations(name),
        qty_received
      `)
      .eq('po_id', purchaseOrder.id)
      .order('line_number')

    if (!error && data) {
      setPOLines(data)
      
      // Initialize receipt lines
      const initialLines: ReceiptLine[] = data.map(line => ({
        po_line_id: line.id,
        qty_received: line.qty - (line.qty_received || 0), // Default to remaining qty
        unit_cost: line.expected_unit_cost,
        lot_code: generateLotCode(),
        location_id: line.location_id,
        has_variance: false,
        variance_pct: 0
      }))
      setReceiptLines(initialLines)
    }
  }

  const generateLotCode = () => {
    return `LOT-${format(new Date(), 'yyyyMMdd-HHmmss')}`
  }

  const updateReceiptLine = (index: number, field: keyof ReceiptLine, value: any) => {
    const newLines = [...receiptLines]
    newLines[index] = { ...newLines[index], [field]: value }
    
    // Calculate variance if unit cost changed
    if (field === 'unit_cost') {
      const poLine = poLines[index]
      if (poLine) {
        const variance = ((value - poLine.expected_unit_cost) / poLine.expected_unit_cost) * 100
        newLines[index].variance_pct = variance
        newLines[index].has_variance = Math.abs(variance) > 5
      }
    }
    
    setReceiptLines(newLines)
    calculateTotalVariance(newLines)
  }

  const calculateTotalVariance = (lines: ReceiptLine[]) => {
    let totalExpected = 0
    let totalActual = 0
    let hasVariance = false

    lines.forEach((line, index) => {
      const poLine = poLines[index]
      if (poLine && line.qty_received > 0) {
        totalExpected += poLine.expected_unit_cost * line.qty_received
        totalActual += line.unit_cost * line.qty_received
        if (line.has_variance) hasVariance = true
      }
    })

    const variance = totalActual - totalExpected
    setTotalVariance(variance)
    setHasSignificantVariance(hasVariance)
  }

  const handleReceiveAll = () => {
    const newLines = poLines.map((line, index) => ({
      ...receiptLines[index],
      qty_received: line.qty - (line.qty_received || 0)
    }))
    setReceiptLines(newLines)
    calculateTotalVariance(newLines)
  }

  const handleSubmit = async () => {
    const linesToReceive = receiptLines.filter(line => line.qty_received > 0)
    
    if (linesToReceive.length === 0) {
      toast.error('Please enter quantities to receive')
      return
    }

    try {
      setLoading(true)

      const { data, error } = await supabase.rpc('receive_purchase_order', {
        p_po_id: purchaseOrder.id,
        p_receipt_lines: linesToReceive.map(line => ({
          po_line_id: line.po_line_id,
          qty_received: line.qty_received,
          unit_cost: line.unit_cost,
          lot_code: line.lot_code,
          expiry: line.expiry?.toISOString().split('T')[0] || null,
          location_id: line.location_id
        })),
        p_notes: notes || null
      })

      if (error) throw error

      // Track telemetry event
      const totalReceived = linesToReceive.reduce((sum, line) => sum + line.qty_received, 0)
      const totalExpected = poLines.reduce((sum, line) => sum + line.qty, 0)
      const isPartial = totalReceived < totalExpected
      
      await trackEvent('po_received', {
        po_id: purchaseOrder.id,
        receipt_id: data,
        vendor_id: purchaseOrder.vendor.id,
        variance_detected: hasSignificantVariance,
        partial: isPartial,
        line_count: linesToReceive.length,
        total_value: linesToReceive.reduce((sum, line) => sum + (line.qty_received * line.unit_cost), 0),
      })

      toast.success('Receipt processed successfully')
      onSuccess()
    } catch (error) {
      console.error('Error receiving PO:', error)
      toast.error('Failed to process receipt')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receive Purchase Order</DialogTitle>
          <DialogDescription>
            PO {purchaseOrder.po_number} - {purchaseOrder.vendor.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {hasSignificantVariance && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Price variance detected. Some items have costs that differ by more than 5% from the expected price.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReceiveAll}
            >
              Receive All Remaining
            </Button>
          </div>

          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Ordered</TableHead>
                  <TableHead>Already Received</TableHead>
                  <TableHead>Receive Qty</TableHead>
                  <TableHead>Unit Cost</TableHead>
                  <TableHead>Variance</TableHead>
                  <TableHead>Lot Code</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {poLines.map((line, index) => {
                  const receipt = receiptLines[index]
                  if (!receipt) return null

                  const remaining = line.qty - (line.qty_received || 0)
                  const lineTotal = receipt.qty_received * receipt.unit_cost

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
                      <TableCell>
                        {line.qty} {line.uom}
                      </TableCell>
                      <TableCell>
                        {line.qty_received || 0} {line.uom}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={receipt.qty_received}
                          onChange={(e) => updateReceiptLine(index, 'qty_received', parseFloat(e.target.value) || 0)}
                          min="0"
                          max={remaining}
                          step="0.01"
                          className="w-24"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">$</span>
                          <Input
                            type="number"
                            value={receipt.unit_cost}
                            onChange={(e) => updateReceiptLine(index, 'unit_cost', parseFloat(e.target.value) || 0)}
                            min="0"
                            step="0.01"
                            className="w-24"
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        {receipt.has_variance ? (
                          <Badge variant={receipt.variance_pct > 0 ? "destructive" : "success"}>
                            {receipt.variance_pct > 0 ? (
                              <TrendingUp className="mr-1 h-3 w-3" />
                            ) : (
                              <TrendingDown className="mr-1 h-3 w-3" />
                            )}
                            {Math.abs(receipt.variance_pct).toFixed(1)}%
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          value={receipt.lot_code}
                          onChange={(e) => updateReceiptLine(index, 'lot_code', e.target.value)}
                          className="w-32"
                        />
                      </TableCell>
                      <TableCell>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className={cn(
                                "w-24 justify-start text-left font-normal",
                                !receipt.expiry && "text-muted-foreground"
                              )}
                            >
                              <CalendarIcon className="mr-2 h-3 w-3" />
                              {receipt.expiry ? format(receipt.expiry, "MM/dd") : "-"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0">
                            <Calendar
                              mode="single"
                              selected={receipt.expiry}
                              onSelect={(date) => updateReceiptLine(index, 'expiry', date)}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${lineTotal.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {totalVariance !== 0 && (
            <div className="flex justify-end">
              <div className="text-right space-y-1">
                <div className="text-sm text-muted-foreground">Total Variance</div>
                <div className={cn(
                  "text-2xl font-bold",
                  totalVariance > 0 ? "text-red-600" : "text-green-600"
                )}>
                  {totalVariance > 0 ? '+' : ''}${Math.abs(totalVariance).toFixed(2)}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Receipt Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about this receipt..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            <Package className="mr-2 h-4 w-4" />
            {loading ? 'Processing...' : 'Receive Items'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}