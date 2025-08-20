'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import { Button } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@brewcrush/ui';
import { Label } from '@brewcrush/ui';
import { Input } from '@brewcrush/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@brewcrush/ui';
import { RadioGroup, RadioGroupItem } from '@brewcrush/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@brewcrush/ui';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@brewcrush/ui';
import { 
  Truck, 
  Plus, 
  FileText, 
  Download,
  Send,
  Package,
  Building2,
  CheckCircle,
  Clock
} from 'lucide-react';
import { format } from 'date-fns';
import { useSupabase } from '@/hooks/useSupabase';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

const transferSchema = z.object({
  shipper_entity_id: z.string().uuid(),
  receiver_entity_id: z.string().uuid(),
  same_ownership: z.boolean(),
  shipped_at: z.string(),
  container_type: z.enum(['keg', 'case', 'bulk']),
  lines: z.array(z.object({
    finished_lot_id: z.string().uuid().optional(),
    bulk_reference: z.string().optional(),
    qty: z.number().positive(),
    uom: z.string()
  })).min(1),
  remarks: z.string().optional()
});

type TransferFormData = z.infer<typeof transferSchema>;

interface TransfersInBondProps {
  workspaceId: string;
}

export function TransfersInBond({ workspaceId }: TransfersInBondProps) {
  const supabase = useSupabase();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('outbound');
  const [selectedTransfer, setSelectedTransfer] = useState<any>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch
  } = useForm<TransferFormData>({
    resolver: zodResolver(transferSchema)
  });

  // Mock data - would be fetched from API
  const transfers = {
    outbound: [
      {
        id: '1',
        doc_number: '2025-000001',
        receiver: 'Partner Brewery Co.',
        shipped_at: new Date('2025-01-15'),
        received_at: new Date('2025-01-17'),
        container_type: 'keg',
        total_barrels: 45.67,
        same_ownership: false,
        status: 'received'
      },
      {
        id: '2',
        doc_number: '2025-000002',
        receiver: 'Sister Brewery LLC',
        shipped_at: new Date('2025-01-20'),
        received_at: null,
        container_type: 'bulk',
        total_barrels: 123.45,
        same_ownership: true,
        status: 'in_transit'
      }
    ],
    inbound: [
      {
        id: '3',
        doc_number: 'EXT-2025-0123',
        shipper: 'Regional Brewery Inc.',
        shipped_at: new Date('2025-01-10'),
        received_at: new Date('2025-01-12'),
        container_type: 'case',
        total_barrels: 67.89,
        same_ownership: false,
        status: 'received'
      }
    ]
  };

  const entities = [
    { id: 'ent-1', name: 'Our Brewery (Self)', ttb_permit: 'BR-CA-12345' },
    { id: 'ent-2', name: 'Partner Brewery Co.', ttb_permit: 'BR-CA-67890' },
    { id: 'ent-3', name: 'Sister Brewery LLC', ttb_permit: 'BR-CA-54321' },
    { id: 'ent-4', name: 'Regional Brewery Inc.', ttb_permit: 'BR-NY-98765' }
  ];

  const onSubmit = async (data: TransferFormData) => {
    try {
      const { data: result, error } = await supabase.rpc('create_inbond_transfer', {
        p_data: data,
        p_dry_run: false
      });

      if (error) throw error;

      console.log('Transfer created:', result);
      setIsCreateOpen(false);
      reset();
    } catch (error) {
      console.error('Error creating transfer:', error);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'received':
        return <Badge variant="success"><CheckCircle className="h-3 w-3 mr-1" />Received</Badge>;
      case 'in_transit':
        return <Badge variant="warning"><Clock className="h-3 w-3 mr-1" />In Transit</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Transfers in Bond</CardTitle>
              <CardDescription>
                Manage tax-free transfers between TTB-registered breweries
              </CardDescription>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  New Transfer
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create In-Bond Transfer</DialogTitle>
                  <DialogDescription>
                    Record a transfer without payment of tax per 27 CFR §25.186
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="shipper">Shipper</Label>
                      <Select {...register('shipper_entity_id')}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select shipper" />
                        </SelectTrigger>
                        <SelectContent>
                          {entities.map(entity => (
                            <SelectItem key={entity.id} value={entity.id}>
                              {entity.name} ({entity.ttb_permit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="receiver">Receiver</Label>
                      <Select {...register('receiver_entity_id')}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select receiver" />
                        </SelectTrigger>
                        <SelectContent>
                          {entities.map(entity => (
                            <SelectItem key={entity.id} value={entity.id}>
                              {entity.name} ({entity.ttb_permit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Ownership</Label>
                    <RadioGroup defaultValue="false">
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="true" id="same" />
                        <Label htmlFor="same">Same ownership</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="false" id="different" />
                        <Label htmlFor="different">Different ownership</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="shipped_at">Ship Date</Label>
                      <Input 
                        type="date" 
                        {...register('shipped_at')}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="container_type">Container Type</Label>
                      <Select {...register('container_type')}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="keg">Kegs</SelectItem>
                          <SelectItem value="case">Cases</SelectItem>
                          <SelectItem value="bulk">Bulk</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Container Details</Label>
                    <div className="border rounded-lg p-4 space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <Input placeholder="Quantity" type="number" />
                        <Input placeholder="Size (e.g., 1/2 BBL)" />
                        <Input placeholder="Total BBL" type="number" step="0.01" />
                      </div>
                      <Button type="button" variant="outline" size="sm">
                        <Plus className="h-3 w-3 mr-1" />
                        Add Line
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="remarks">Remarks (Optional)</Label>
                    <Input 
                      {...register('remarks')}
                      placeholder="Any special notes or conditions"
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit">
                      Create Transfer
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
      </Card>

      {/* Transfers Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="outbound" className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            Outbound
          </TabsTrigger>
          <TabsTrigger value="inbound" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Inbound
          </TabsTrigger>
        </TabsList>

        <TabsContent value="outbound" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Outbound Transfers</CardTitle>
              <CardDescription>Beer shipped to other breweries</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document #</TableHead>
                    <TableHead>Receiver</TableHead>
                    <TableHead>Ship Date</TableHead>
                    <TableHead>Container</TableHead>
                    <TableHead className="text-right">Barrels</TableHead>
                    <TableHead>Ownership</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.outbound.map(transfer => (
                    <TableRow key={transfer.id}>
                      <TableCell className="font-mono">{transfer.doc_number}</TableCell>
                      <TableCell>{transfer.receiver}</TableCell>
                      <TableCell>{format(transfer.shipped_at, 'MMM dd, yyyy')}</TableCell>
                      <TableCell className="capitalize">{transfer.container_type}</TableCell>
                      <TableCell className="text-right font-mono">
                        {transfer.total_barrels.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={transfer.same_ownership ? 'secondary' : 'outline'}>
                          {transfer.same_ownership ? 'Same' : 'Different'}
                        </Badge>
                      </TableCell>
                      <TableCell>{getStatusBadge(transfer.status)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm">
                          <FileText className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inbound" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Inbound Transfers</CardTitle>
              <CardDescription>Beer received from other breweries</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document #</TableHead>
                    <TableHead>Shipper</TableHead>
                    <TableHead>Ship Date</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead>Container</TableHead>
                    <TableHead className="text-right">Barrels</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.inbound.map(transfer => (
                    <TableRow key={transfer.id}>
                      <TableCell className="font-mono">{transfer.doc_number}</TableCell>
                      <TableCell>{transfer.shipper}</TableCell>
                      <TableCell>{format(transfer.shipped_at, 'MMM dd, yyyy')}</TableCell>
                      <TableCell>
                        {transfer.received_at ? format(transfer.received_at, 'MMM dd, yyyy') : '-'}
                      </TableCell>
                      <TableCell className="capitalize">{transfer.container_type}</TableCell>
                      <TableCell className="text-right font-mono">
                        {transfer.total_barrels.toFixed(2)}
                      </TableCell>
                      <TableCell>{getStatusBadge(transfer.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {transfer.status === 'in_transit' && (
                            <Button variant="ghost" size="sm">
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm">
                            <FileText className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Shipped (MTD)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">169.12 BBL</div>
            <p className="text-xs text-muted-foreground">2 transfers</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Received (MTD)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">67.89 BBL</div>
            <p className="text-xs text-muted-foreground">1 transfer</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">In Transit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">123.45 BBL</div>
            <p className="text-xs text-muted-foreground">1 pending receipt</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}