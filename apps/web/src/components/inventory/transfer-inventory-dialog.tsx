'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { inventoryTransferSchema, type InventoryTransferInput } from '@brewcrush/zod-schemas'
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
  useToast,
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@brewcrush/ui'
import { AlertTriangle, ArrowRight, MapPin, Package } from 'lucide-react'

interface TransferInventoryDialogProps {
  item: any
  locations: any[]
  onClose: () => void
  onSuccess: () => void
}

export function TransferInventoryDialog({ 
  item, 
  locations, 
  onClose, 
  onSuccess 
}: TransferInventoryDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [availableLots, setAvailableLots] = useState<any[]>([])
  const [selectedLot, setSelectedLot] = useState<any>(null)
  const router = useRouter()
  const { toast } = useToast()
  const supabase = createClient()

  const form = useForm<InventoryTransferInput>({
    resolver: zodResolver(inventoryTransferSchema),
    defaultValues: {
      itemLotId: '',
      qty: 0,
      fromLocationId: item.location_id,
      toLocationId: '',
      notes: '',
    },
  })

  // Fetch available lots for the item at the current location
  useEffect(() => {
    async function fetchLots() {
      const { data, error } = await supabase
        .from('item_lots')
        .select('*')
        .eq('item_id', item.item_id)
        .eq('location_id', item.location_id)
        .gt('qty', 0)
        .order('fifo_index', { ascending: true })

      if (!error && data) {
        setAvailableLots(data)
        if (data.length > 0) {
          // Auto-select the first lot (FIFO)
          form.setValue('itemLotId', data[0].id)
          setSelectedLot(data[0])
        }
      }
    }

    fetchLots()
  }, [item, supabase, form])

  async function onSubmit(values: InventoryTransferInput) {
    if (values.fromLocationId === values.toLocationId) {
      toast({
        title: 'Invalid transfer',
        description: 'Source and destination locations must be different.',
        variant: 'destructive',
      })
      return
    }

    setIsLoading(true)
    try {
      // Call the inventory_transfer RPC
      const { data, error } = await supabase.rpc('inventory_transfer', {
        p_item_lot_id: values.itemLotId,
        p_qty: values.qty,
        p_from_location_id: values.fromLocationId,
        p_to_location_id: values.toLocationId,
        p_notes: values.notes || null,
      })

      if (error) throw error

      const fromLocation = locations.find(l => l.id === values.fromLocationId)?.name
      const toLocation = locations.find(l => l.id === values.toLocationId)?.name

      toast({
        title: 'Transfer completed',
        description: `Transferred ${values.qty} ${item.primary_uom} of ${item.item_name} from ${fromLocation} to ${toLocation}.`,
      })

      onSuccess()
      router.refresh()
    } catch (error: any) {
      console.error('Error transferring inventory:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to transfer inventory. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const maxTransferQty = selectedLot?.qty || 0
  const transferQty = form.watch('qty') || 0
  const isValidTransfer = transferQty > 0 && transferQty <= maxTransferQty

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Transfer Inventory</DialogTitle>
          <DialogDescription>
            Transfer {item.item_name} between locations
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Item Info Card */}
            <Card className="bg-secondary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center">
                  <Package className="h-4 w-4 mr-2" />
                  {item.item_name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">SKU:</span>
                  <span>{item.sku || 'N/A'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Location:</span>
                  <span>{item.location_name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Available:</span>
                  <span className="font-medium">{item.qty_on_hand} {item.primary_uom}</span>
                </div>
              </CardContent>
            </Card>

            {/* Lot Selection */}
            {availableLots.length > 0 ? (
              <FormField
                control={form.control}
                name="itemLotId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Select Lot</FormLabel>
                    <Select 
                      onValueChange={(value) => {
                        field.onChange(value)
                        const lot = availableLots.find(l => l.id === value)
                        setSelectedLot(lot)
                      }} 
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select lot to transfer" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableLots.map(lot => (
                          <SelectItem key={lot.id} value={lot.id}>
                            {lot.lot_code} - {lot.qty} {item.primary_uom} available
                            {lot.expiry && ` (Exp: ${new Date(lot.expiry).toLocaleDateString()})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Lots are ordered by FIFO (First In, First Out)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  No lots available at this location for transfer.
                </AlertDescription>
              </Alert>
            )}

            {/* Transfer Quantity */}
            <FormField
              control={form.control}
              name="qty"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Transfer Quantity</FormLabel>
                  <FormControl>
                    <Input 
                      type="number" 
                      placeholder="Enter quantity to transfer"
                      min="0"
                      max={maxTransferQty}
                      step="0.01"
                      {...field}
                      onChange={e => field.onChange(e.target.valueAsNumber || 0)}
                    />
                  </FormControl>
                  <FormDescription>
                    Maximum available: {maxTransferQty} {item.primary_uom}
                  </FormDescription>
                  {transferQty > maxTransferQty && (
                    <p className="text-sm text-destructive">
                      Transfer quantity exceeds available amount
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Location Transfer */}
            <div className="space-y-2">
              <FormLabel>Transfer Locations</FormLabel>
              <div className="flex items-center gap-2">
                <FormField
                  control={form.control}
                  name="fromLocationId"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <Select onValueChange={field.onChange} defaultValue={field.value} disabled>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="From location" />
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
                    </FormItem>
                  )}
                />
                
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                
                <FormField
                  control={form.control}
                  name="toLocationId"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="To location" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {locations
                            .filter(l => l.id !== form.watch('fromLocationId'))
                            .map(location => (
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
              </div>
            </div>

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Additional details about this transfer..."
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
                disabled={
                  isLoading || 
                  !isValidTransfer || 
                  !form.watch('toLocationId') ||
                  availableLots.length === 0
                }
              >
                {isLoading ? 'Processing...' : 'Transfer Inventory'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}