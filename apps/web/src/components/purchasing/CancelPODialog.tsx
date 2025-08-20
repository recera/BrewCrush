'use client'

import { useState } from 'react'
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
import { Label } from '@brewcrush/ui/label'
import { Textarea } from '@brewcrush/ui/textarea'
import { Alert, AlertDescription } from '@brewcrush/ui/alert'
import { AlertTriangle, Ban } from 'lucide-react'
import { toast } from '@brewcrush/ui'
import { trackEvent } from '@/lib/telemetry'

interface PurchaseOrder {
  id: string
  po_number: string
  status: string
  vendors: {
    name: string
  }
  po_lines: {
    qty: number
    expected_unit_cost: number
  }[]
}

interface CancelPODialogProps {
  po: PurchaseOrder | null
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export function CancelPODialog({ po, isOpen, onClose, onSuccess }: CancelPODialogProps) {
  const supabase = useSupabase()
  const [loading, setLoading] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const calculateTotal = () => {
    if (!po) return 0
    return po.po_lines.reduce((sum, line) => sum + (line.qty * line.expected_unit_cost), 0)
  }

  const handleCancel = async () => {
    if (!po) return
    
    if (!reason.trim()) {
      setError('Please provide a reason for cancellation')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { error } = await supabase.rpc('cancel_purchase_order', {
        p_po_id: po.id,
        p_reason: reason.trim()
      })

      if (error) throw error

      // Track telemetry event
      await trackEvent('po_cancelled', {
        po_id: po.id,
        status: po.status,
        total_amount: calculateTotal(),
        reason: reason.trim(),
      })

      toast.success(`Purchase order ${po.po_number} has been cancelled`)
      onSuccess()
      onClose()
      setReason('')
    } catch (error: any) {
      console.error('Error cancelling PO:', error)
      setError(error.message || 'Failed to cancel purchase order')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setReason('')
    setError(null)
    onClose()
  }

  if (!po) return null

  const canCancel = po.status !== 'closed' && po.status !== 'cancelled'

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Cancel Purchase Order
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to cancel PO {po.po_number}?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* PO Summary */}
          <div className="bg-muted p-4 rounded-lg space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">PO Number:</span>
              <span className="font-medium">{po.po_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Vendor:</span>
              <span className="font-medium">{po.vendors.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Current Status:</span>
              <span className="font-medium capitalize">{po.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Value:</span>
              <span className="font-medium">${calculateTotal().toFixed(2)}</span>
            </div>
          </div>

          {!canCancel ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This purchase order cannot be cancelled because it is already {po.status}.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Warning:</strong> Cancelling this purchase order is permanent and cannot be undone. 
                  If this PO has any receipts, they must be reversed first.
                </AlertDescription>
              </Alert>

              {/* Cancellation Reason */}
              <div className="space-y-2">
                <Label htmlFor="reason">
                  Cancellation Reason <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Please provide a detailed reason for cancelling this purchase order..."
                  rows={4}
                  required
                />
                <p className="text-sm text-muted-foreground">
                  This reason will be recorded in the audit log and added to the PO notes.
                </p>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Close
          </Button>
          {canCancel && (
            <Button 
              variant="destructive"
              onClick={handleCancel}
              disabled={loading || !reason.trim()}
            >
              {loading ? 'Cancelling...' : 'Cancel PO'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}