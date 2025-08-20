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
import { CalendarIcon, Plus, Trash2, Package } from 'lucide-react'
import { cn } from '@brewcrush/ui/lib/utils'
import { toast } from '@brewcrush/ui'
import { trackEvent } from '@/lib/telemetry'

interface Vendor {
  id: string
  name: string
  email: string | null
  terms: string | null
}

interface Item {
  id: string
  name: string
  sku: string | null
  uom: string
  reorder_level: number | null
  reorder_qty: number | null
}

interface Location {
  id: string
  name: string
  is_default: boolean
}

interface POLine {
  item_id: string
  qty: number
  uom: string
  expected_unit_cost: number
  location_id: string
  notes?: string
}

interface CreatePODialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  vendorId?: string
  suggestedItems?: string[]
}

export function CreatePODialog({ 
  open, 
  onOpenChange, 
  onSuccess,
  vendorId,
  suggestedItems = []
}: CreatePODialogProps) {
  const supabase = useSupabase()
  const [loading, setLoading] = useState(false)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [selectedVendor, setSelectedVendor] = useState<string>(vendorId || '')
  const [dueDate, setDueDate] = useState<Date>()
  const [terms, setTerms] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<POLine[]>([])
  const [lastPrices, setLastPrices] = useState<Record<string, number>>({})

  useEffect(() => {
    if (open) {
      fetchVendors()
      fetchItems()
      fetchLocations()
      if (vendorId) {
        setSelectedVendor(vendorId)
        fetchVendorPrices(vendorId)
      }
      if (suggestedItems.length > 0) {
        initializeSuggestedItems()
      }
    }
  }, [open, vendorId, suggestedItems])

  const fetchVendors = async () => {
    const { data, error } = await supabase
      .from('vendors')
      .select('*')
      .order('name')

    if (!error && data) {
      setVendors(data)
    }
  }

  const fetchItems = async () => {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (!error && data) {
      setItems(data)
    }
  }

  const fetchLocations = async () => {
    const { data, error } = await supabase
      .from('inventory_locations')
      .select('*')
      .order('name')

    if (!error && data) {
      setLocations(data)
    }
  }

  const fetchVendorPrices = async (vendorId: string) => {
    const { data, error } = await supabase
      .from('supplier_price_history')
      .select('item_id, unit_cost')
      .eq('vendor_id', vendorId)
      .order('receipt_date', { ascending: false })

    if (!error && data) {
      const prices: Record<string, number> = {}
      data.forEach(record => {
        if (!prices[record.item_id]) {
          prices[record.item_id] = record.unit_cost
        }
      })
      setLastPrices(prices)
    }
  }

  const initializeSuggestedItems = async () => {
    const defaultLocation = locations.find(l => l.is_default) || locations[0]
    
    if (defaultLocation) {
      const newLines: POLine[] = suggestedItems.map(itemId => {
        const item = items.find(i => i.id === itemId)
        return {
          item_id: itemId,
          qty: item?.reorder_qty || 0,
          uom: item?.uom || '',
          expected_unit_cost: lastPrices[itemId] || 0,
          location_id: defaultLocation.id,
        }
      })
      setLines(newLines)
    }
  }

  const handleVendorChange = (vendorId: string) => {
    setSelectedVendor(vendorId)
    const vendor = vendors.find(v => v.id === vendorId)
    if (vendor) {
      setTerms(vendor.terms || '')
      fetchVendorPrices(vendorId)
    }
  }

  const addLine = () => {
    const defaultLocation = locations.find(l => l.is_default) || locations[0]
    if (defaultLocation) {
      setLines([...lines, {
        item_id: '',
        qty: 1,
        uom: '',
        expected_unit_cost: 0,
        location_id: defaultLocation.id,
      }])
    }
  }

  const updateLine = (index: number, field: keyof POLine, value: any) => {
    const newLines = [...lines]
    newLines[index] = { ...newLines[index], [field]: value }
    
    // If item changed, update UOM and last price
    if (field === 'item_id' && value) {
      const item = items.find(i => i.id === value)
      if (item) {
        newLines[index].uom = item.uom
        newLines[index].expected_unit_cost = lastPrices[value] || 0
      }
    }
    
    setLines(newLines)
  }

  const removeLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index))
  }

  const calculateTotal = () => {
    return lines.reduce((sum, line) => sum + (line.qty * line.expected_unit_cost), 0)
  }

  const handleSubmit = async () => {
    if (!selectedVendor) {
      toast.error('Please select a vendor')
      return
    }

    if (lines.length === 0) {
      toast.error('Please add at least one line item')
      return
    }

    const invalidLines = lines.filter(line => !line.item_id || line.qty <= 0)
    if (invalidLines.length > 0) {
      toast.error('Please complete all line items')
      return
    }

    try {
      setLoading(true)

      const { data, error } = await supabase.rpc('create_purchase_order', {
        p_vendor_id: selectedVendor,
        p_due_date: dueDate?.toISOString().split('T')[0] || null,
        p_terms: terms || null,
        p_notes: notes || null,
        p_lines: lines
      })

      if (error) throw error

      // Track telemetry event
      await trackEvent('po_created', {
        po_id: data,
        vendor_id: selectedVendor,
        total_amount: calculateTotal(),
        line_count: lines.length,
        has_due_date: !!dueDate,
      })

      toast.success('Purchase order created successfully')
      onSuccess()
    } catch (error) {
      console.error('Error creating PO:', error)
      toast.error('Failed to create purchase order')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Purchase Order</DialogTitle>
          <DialogDescription>
            Create a new purchase order for inventory items
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vendor">Vendor *</Label>
              <Select value={selectedVendor} onValueChange={handleVendorChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map(vendor => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="due-date">Due Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !dueDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dueDate ? format(dueDate, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={dueDate}
                    onSelect={setDueDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="terms">Payment Terms</Label>
            <Input
              id="terms"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="e.g., Net 30"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Line Items</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addLine}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Item
              </Button>
            </div>

            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[300px]">Item</TableHead>
                    <TableHead className="w-[100px]">Qty</TableHead>
                    <TableHead className="w-[80px]">UOM</TableHead>
                    <TableHead className="w-[120px]">Unit Cost</TableHead>
                    <TableHead className="w-[150px]">Location</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No items added. Click "Add Item" to start.
                      </TableCell>
                    </TableRow>
                  ) : (
                    lines.map((line, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Select 
                            value={line.item_id} 
                            onValueChange={(value) => updateLine(index, 'item_id', value)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select item" />
                            </SelectTrigger>
                            <SelectContent>
                              {items.map(item => (
                                <SelectItem key={item.id} value={item.id}>
                                  <div className="flex items-center gap-2">
                                    <Package className="h-4 w-4" />
                                    <span>{item.name}</span>
                                    {item.sku && (
                                      <span className="text-xs text-muted-foreground">
                                        ({item.sku})
                                      </span>
                                    )}
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
                            onChange={(e) => updateLine(index, 'qty', parseFloat(e.target.value) || 0)}
                            min="0"
                            step="0.01"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={line.uom}
                            readOnly
                            className="bg-gray-50"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={line.expected_unit_cost}
                            onChange={(e) => updateLine(index, 'expected_unit_cost', parseFloat(e.target.value) || 0)}
                            min="0"
                            step="0.01"
                          />
                        </TableCell>
                        <TableCell>
                          <Select 
                            value={line.location_id} 
                            onValueChange={(value) => updateLine(index, 'location_id', value)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {locations.map(location => (
                                <SelectItem key={location.id} value={location.id}>
                                  {location.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          ${(line.qty * line.expected_unit_cost).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLine(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {lines.length > 0 && (
              <div className="flex justify-end pt-4">
                <div className="text-right">
                  <div className="text-2xl font-bold">
                    Total: ${calculateTotal().toFixed(2)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Creating...' : 'Create PO'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}