'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { inventoryAdjustmentSchema, type InventoryAdjustmentInput } from '@brewcrush/zod-schemas'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  RadioGroup,
  RadioGroupItem,
  useToast,
  Alert,
  AlertDescription,
} from '@brewcrush/ui'
import { AlertTriangle, Plus, Minus } from 'lucide-react'

interface AdjustInventoryDialogProps {
  item: any
  locations: any[]
  onClose: () => void
  onSuccess: () => void
}

export function AdjustInventoryDialog({ item, locations, onClose, onSuccess }: AdjustInventoryDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [adjustmentType, setAdjustmentType] = useState<'add' | 'remove'>('add')
  const router = useRouter()
  const { toast } = useToast()
  const supabase = createClient()

  const form = useForm<InventoryAdjustmentInput>({
    resolver: zodResolver(inventoryAdjustmentSchema),
    defaultValues: {
      itemId: item.item_id,
      qty: 0,
      uom: item.primary_uom,
      locationId: item.location_id,
      reason: '',
      notes: '',
    },
  })

  async function onSubmit(values: InventoryAdjustmentInput) {
    setIsLoading(true)
    try {
      // Adjust quantity based on type (negative for removals)
      const adjustedQty = adjustmentType === 'remove' ? -Math.abs(values.qty) : Math.abs(values.qty)

      // Call the inventory_adjust RPC
      const { data, error } = await supabase.rpc('inventory_adjust', {
        p_item_id: values.itemId,
        p_qty: adjustedQty,
        p_uom: values.uom,
        p_location_id: values.locationId,
        p_reason: values.reason,
        p_notes: values.notes || null,
        p_lot_id: values.itemLotId || null,
      })

      if (error) throw error

      toast({
        title: 'Inventory adjusted',
        description: `${item.item_name} quantity ${adjustmentType === 'add' ? 'increased' : 'decreased'} by ${Math.abs(values.qty)} ${values.uom}.`,
      })

      onSuccess()
      router.refresh()
    } catch (error: any) {
      console.error('Error adjusting inventory:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to adjust inventory. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const currentQty = item.qty_on_hand || 0
  const adjustedQty = adjustmentType === 'add' 
    ? currentQty + (form.watch('qty') || 0)
    : currentQty - (form.watch('qty') || 0)

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adjust Inventory</DialogTitle>
          <DialogDescription>
            Adjust the quantity of {item.item_name}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Adjustment Type */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Adjustment Type</label>
              <RadioGroup value={adjustmentType} onValueChange={(value: any) => setAdjustmentType(value)}>
                <div className="flex space-x-4">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="add" id="add" />
                    <label htmlFor="add" className="flex items-center cursor-pointer">
                      <Plus className="h-4 w-4 mr-1" />
                      Add Inventory
                    </label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="remove" id="remove" />
                    <label htmlFor="remove" className="flex items-center cursor-pointer">
                      <Minus className="h-4 w-4 mr-1" />
                      Remove Inventory
                    </label>
                  </div>
                </div>
              </RadioGroup>
            </div>

            {/* Current and New Quantity Display */}
            <div className="bg-secondary/20 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span>Current Quantity:</span>
                <span className="font-medium">{currentQty} {item.primary_uom}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>After Adjustment:</span>
                <span className={`font-medium ${adjustedQty < 0 ? 'text-destructive' : ''}`}>
                  {adjustedQty} {item.primary_uom}
                </span>
              </div>
            </div>

            {adjustedQty < 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This adjustment will result in negative inventory. Admin approval may be required.
                </AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="qty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity</FormLabel>
                  <FormControl>
                    <Input 
                      type="number" 
                      placeholder="Enter quantity"
                      min="0"
                      step="0.01"
                      {...field}
                      onChange={e => field.onChange(e.target.valueAsNumber || 0)}
                    />
                  </FormControl>
                  <FormDescription>
                    Amount to {adjustmentType === 'add' ? 'add to' : 'remove from'} inventory
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="locationId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Location</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select location" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {locations.map(location => (
                        <SelectItem key={location.id} value={location.id}>
                          {location.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select reason" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {adjustmentType === 'add' ? (
                        <>
                          <SelectItem value="found">Found Inventory</SelectItem>
                          <SelectItem value="return">Customer Return</SelectItem>
                          <SelectItem value="correction">Correction</SelectItem>
                          <SelectItem value="production_return">Production Return</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="damaged">Damaged</SelectItem>
                          <SelectItem value="expired">Expired</SelectItem>
                          <SelectItem value="lost">Lost</SelectItem>
                          <SelectItem value="theft">Theft</SelectItem>
                          <SelectItem value="sample">Sample/Testing</SelectItem>
                          <SelectItem value="correction">Correction</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Additional details about this adjustment..."
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isLoading || form.watch('qty') === 0}
              >
                {isLoading ? 'Processing...' : 'Adjust Inventory'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}