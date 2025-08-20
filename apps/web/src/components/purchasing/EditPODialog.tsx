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
import { Calendar } from '@brewcrush/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@brewcrush/ui/popover'
import { format } from 'date-fns'
import { CalendarIcon, Plus, Trash2, Package, AlertCircle } from 'lucide-react'
import { cn } from '@brewcrush/ui/lib/utils'
import { toast } from '@brewcrush/ui'
import { Alert, AlertDescription } from '@brewcrush/ui/alert'
import { trackEvent } from '@/lib/telemetry'

interface PurchaseOrder {
  id: string
  po_number: string
  vendor_id: string
  status: string
  order_date: string
  due_date: string | null
  terms: string | null
  notes: string | null
  po_lines: POLine[]
  vendors: {
    id: string
    name: string
    email: string | null
    terms: string | null
  }
}

interface POLine {
  id?: string
  item_id: string
  qty: number
  uom: string
  expected_unit_cost: number
  line_number: number
  notes?: string | null
  items?: {
    id: string
    name: string
    sku: string | null
    uom: string
  }
}

interface Item {
  id: string
  name: string
  sku: string | null
  uom: string
  reorder_level: number | null
  vendor_id: string | null
}

interface EditPODialogProps {
  po: PurchaseOrder
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export function EditPODialog({ po, isOpen, onClose, onSuccess }: EditPODialogProps) {
  const supabase = useSupabase()
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [notes, setNotes] = useState(po.notes || '')
  const [dueDate, setDueDate] = useState<Date | undefined>(
    po.due_date ? new Date(po.due_date) : undefined
  )
  const [lines, setLines] = useState<POLine[]>(po.po_lines || [])
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    if (isOpen) {
      loadItems()
      // Reset form with PO data
      setNotes(po.notes || '')
      setDueDate(po.due_date ? new Date(po.due_date) : undefined)
      setLines(po.po_lines || [])
      setErrors([])
    }
  }, [isOpen, po])

  const loadItems = async () => {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .in('type', ['raw', 'packaging'])
      .order('name')

    if (error) {
      toast.error('Failed to load items')
      return
    }

    setItems(data || [])
  }

  const validateForm = (): boolean => {
    const newErrors: string[] = []

    if (lines.length === 0) {
      newErrors.push('At least one line item is required')
    }

    lines.forEach((line, index) => {
      if (!line.item_id) {
        newErrors.push(`Line ${index + 1}: Item is required`)
      }
      if (!line.qty || line.qty <= 0) {
        newErrors.push(`Line ${index + 1}: Quantity must be greater than 0`)
      }
      if (line.expected_unit_cost < 0) {
        newErrors.push(`Line ${index + 1}: Unit cost cannot be negative`)
      }
    })

    setErrors(newErrors)
    return newErrors.length === 0
  }

  const handleAddLine = () => {
    const newLine: POLine = {
      item_id: '',
      qty: 1,
      uom: '',
      expected_unit_cost: 0,
      line_number: lines.length + 1,
      notes: null,
    }
    setLines([...lines, newLine])
  }

  const handleRemoveLine = (index: number) => {
    const newLines = lines.filter((_, i) => i !== index)
    // Renumber lines
    newLines.forEach((line, i) => {
      line.line_number = i + 1
    })
    setLines(newLines)
  }

  const handleLineChange = (index: number, field: keyof POLine, value: any) => {
    const newLines = [...lines]
    
    if (field === 'item_id') {
      const item = items.find(i => i.id === value)
      if (item) {
        newLines[index] = {
          ...newLines[index],
          item_id: value,
          uom: item.uom,
        }
      }
    } else {
      newLines[index] = {
        ...newLines[index],
        [field]: value,
      }
    }
    
    setLines(newLines)
  }

  const handleSubmit = async () => {
    if (!validateForm()) {
      return
    }

    setLoading(true)

    try {
      // Call the edit_purchase_order function
      const { data, error } = await supabase.rpc('edit_purchase_order', {
        p_po_id: po.id,
        p_due_date: dueDate ? format(dueDate, 'yyyy-MM-dd') : null,
        p_terms: null, // Keep existing terms
        p_notes: notes || null,
        p_lines: lines.map(line => ({
          item_id: line.item_id,
          qty: line.qty,
          uom: line.uom,
          expected_unit_cost: line.expected_unit_cost,
          line_number: line.line_number,
          notes: line.notes,
        })),
      })

      if (error) throw error

      // Track telemetry event
      await trackEvent('po_edited', {
        po_id: po.id,
        vendor_id: po.vendor_id,
        total_amount: calculateTotal(),
        line_count: lines.length,
        has_due_date: !!dueDate,
      })

      toast.success('Purchase order updated successfully')
      onSuccess()
      onClose()
    } catch (error: any) {
      console.error('Error updating PO:', error)
      toast.error(error.message || 'Failed to update purchase order')
    } finally {
      setLoading(false)
    }
  }

  const calculateTotal = () => {
    return lines.reduce((sum, line) => sum + (line.qty * line.expected_unit_cost), 0)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Purchase Order {po.po_number}</DialogTitle>
          <DialogDescription>
            Modify the purchase order details. Only draft POs can be edited.
          </DialogDescription>
        </DialogHeader>

        {po.status !== 'draft' && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This PO is {po.status} and cannot be edited. Only draft POs can be modified.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          {/* Vendor Info (Read-only) */}
          <div className="space-y-2">
            <Label>Vendor</Label>
            <div className="p-2 bg-muted rounded">
              {po.vendors.name} ({po.vendors.email || 'No email'})
            </div>
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label>Due Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !dueDate && "text-muted-foreground"
                  )}
                  disabled={po.status !== 'draft'}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dueDate ? format(dueDate, "PPP") : "Select due date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dueDate}
                  onSelect={setDueDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              disabled={po.status !== 'draft'}
            />
          </div>

          {/* Line Items */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Line Items</Label>
              {po.status === 'draft' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddLine}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Line
                </Button>
              )}
            </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">Item</TableHead>
                    <TableHead className="w-[15%]">Qty</TableHead>
                    <TableHead className="w-[15%]">UOM</TableHead>
                    <TableHead className="w-[15%]">Unit Cost</TableHead>
                    <TableHead className="w-[10%]">Total</TableHead>
                    {po.status === 'draft' && <TableHead className="w-[5%]"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Select
                          value={line.item_id}
                          onValueChange={(value) => handleLineChange(index, 'item_id', value)}
                          disabled={po.status !== 'draft'}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select item" />
                          </SelectTrigger>
                          <SelectContent>
                            {items.map(item => (
                              <SelectItem key={item.id} value={item.id}>
                                <div className="flex items-center gap-2">
                                  <Package className="h-3 w-3" />
                                  <span>{item.name}</span>
                                  {item.sku && <span className="text-muted-foreground">({item.sku})</span>}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={line.qty}
                          onChange={(e) => handleLineChange(index, 'qty', parseFloat(e.target.value) || 0)}
                          min="0.01"
                          step="0.01"
                          disabled={po.status !== 'draft'}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={line.uom}
                          readOnly
                          disabled
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={line.expected_unit_cost}
                          onChange={(e) => handleLineChange(index, 'expected_unit_cost', parseFloat(e.target.value) || 0)}
                          min="0"
                          step="0.01"
                          disabled={po.status !== 'draft'}
                        />
                      </TableCell>
                      <TableCell>
                        ${(line.qty * line.expected_unit_cost).toFixed(2)}
                      </TableCell>
                      {po.status === 'draft' && (
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveLine(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Total */}
            <div className="flex justify-end p-4 border-t">
              <div className="text-lg font-semibold">
                Total: ${calculateTotal().toFixed(2)}
              </div>
            </div>
          </div>

          {/* Validation Errors */}
          {errors.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={loading || po.status !== 'draft'}
          >
            {loading ? 'Updating...' : 'Update PO'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}