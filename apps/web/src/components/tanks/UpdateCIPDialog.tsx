'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@brewcrush/ui';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@brewcrush/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@brewcrush/ui';
import { Textarea } from '@brewcrush/ui';
import { Button } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Card, CardContent } from '@brewcrush/ui';
import { 
  Droplets, 
  AlertCircle, 
  CheckCircle, 
  Clock,
  Settings 
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Tank } from '@/types/production';

const cipSchema = z.object({
  cip_status: z.enum(['clean', 'dirty', 'in_progress', 'required']),
  notes: z.string().optional(),
});

type CIPForm = z.infer<typeof cipSchema>;

interface UpdateCIPDialogProps {
  tank: Tank;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function UpdateCIPDialog({
  tank,
  open,
  onOpenChange,
  onSuccess,
}: UpdateCIPDialogProps) {
  const supabase = createClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<CIPForm>({
    resolver: zodResolver(cipSchema),
    defaultValues: {
      cip_status: tank.cip_status,
      notes: '',
    },
  });

  const onSubmit = async (values: CIPForm) => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('tanks')
        .update({
          cip_status: values.cip_status,
          cip_last_date: values.cip_status === 'clean' ? new Date().toISOString() : tank.cip_last_date,
        })
        .eq('id', tank.id);

      if (error) throw error;

      // Log the change if notes provided
      if (values.notes) {
        await supabase
          .from('audit_logs')
          .insert({
            entity_table: 'tanks',
            entity_id: tank.id,
            action: 'cip_update',
            after: JSON.stringify({
              cip_status: values.cip_status,
              notes: values.notes,
            }),
          });
      }

      onSuccess?.();
      onOpenChange(false);
      form.reset();
    } catch (error) {
      console.error('Error updating CIP status:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusIcon = (status: string) => {
    const icons: Record<string, JSX.Element> = {
      clean: <CheckCircle className="h-5 w-5 text-green-500" />,
      dirty: <AlertCircle className="h-5 w-5 text-yellow-500" />,
      in_progress: <Clock className="h-5 w-5 text-blue-500 animate-spin" />,
      required: <AlertCircle className="h-5 w-5 text-red-500" />,
    };
    return icons[status] || <Droplets className="h-5 w-5" />;
  };

  const getStatusDescription = (status: string) => {
    const descriptions: Record<string, string> = {
      clean: 'Tank has been cleaned and sanitized, ready for use',
      dirty: 'Tank needs cleaning but not urgent',
      in_progress: 'CIP cycle is currently running',
      required: 'Tank must be cleaned before next use',
    };
    return descriptions[status] || '';
  };

  const selectedStatus = form.watch('cip_status');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update CIP Status</DialogTitle>
          <DialogDescription>
            Tank {tank.name} - Current status: {tank.cip_status}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Current Status Card */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  {getStatusIcon(tank.cip_status)}
                  <div className="flex-1">
                    <p className="font-medium capitalize">
                      {tank.cip_status.replace('_', ' ')}
                    </p>
                    {tank.cip_last_date && tank.cip_status === 'clean' && (
                      <p className="text-sm text-muted-foreground">
                        Last cleaned: {new Date(tank.cip_last_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <FormField
              control={form.control}
              name="cip_status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {['clean', 'dirty', 'in_progress', 'required'].map((status) => (
                        <SelectItem key={status} value={status}>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(status)}
                            <span className="capitalize">{status.replace('_', ' ')}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedStatus && (
                    <FormDescription>
                      {getStatusDescription(selectedStatus)}
                    </FormDescription>
                  )}
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
                      placeholder="Add any notes about the cleaning process..."
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Document any specific cleaning procedures or issues
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Status Change Warnings */}
            {selectedStatus === 'clean' && tank.cip_status !== 'clean' && (
              <Card className="border-green-200 bg-green-50">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium text-green-800">
                        Tank will be marked as ready for use
                      </p>
                      <p className="text-green-700">
                        Make sure all cleaning and sanitization steps have been completed
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {selectedStatus === 'required' && tank.cip_status !== 'required' && (
              <Card className="border-red-200 bg-red-50">
                <CardContent className="pt-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium text-red-800">
                        Tank will be marked as requiring immediate cleaning
                      </p>
                      <p className="text-red-700">
                        This tank cannot be used for new batches until cleaned
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={isSubmitting || selectedStatus === tank.cip_status}
              >
                {isSubmitting ? (
                  <>
                    <Settings className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <Droplets className="mr-2 h-4 w-4" />
                    Update Status
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}