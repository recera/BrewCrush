'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import { Button } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@brewcrush/ui';
import { Label } from '@brewcrush/ui';
import { Input } from '@brewcrush/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@brewcrush/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@brewcrush/ui';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@brewcrush/ui';
import { 
  Beer, 
  DollarSign, 
  Download, 
  Plus,
  TrendingUp,
  TrendingDown,
  Calendar,
  User,
  FileText
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { useSupabase } from '@/hooks/useSupabase';

interface KegDepositLedgerProps {
  workspaceId: string;
}

interface KegDepositEntry {
  id: string;
  customer_id?: string;
  customer_name?: string;
  sku_id?: string;
  sku_name?: string;
  entry_date: Date;
  qty: number;
  amount_cents: number;
  direction: 'charged' | 'returned';
  reference_doc?: string;
  notes?: string;
  created_at: Date;
  created_by?: string;
}

interface Customer {
  id: string;
  name: string;
  balance_cents: number;
  kegs_out: number;
}

export function KegDepositLedger({ workspaceId }: KegDepositLedgerProps) {
  const supabase = useSupabase();
  const [entries, setEntries] = useState<KegDepositEntry[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState('current');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newEntry, setNewEntry] = useState({
    customer_id: '',
    sku_id: '',
    qty: 1,
    amount: 50, // Default $50 per keg
    direction: 'charged' as 'charged' | 'returned',
    reference_doc: '',
    notes: '',
  });

  // Calculate summary metrics
  const calculateMetrics = () => {
    const totalCharged = entries
      .filter(e => e.direction === 'charged')
      .reduce((sum, e) => sum + e.amount_cents, 0);
    
    const totalReturned = entries
      .filter(e => e.direction === 'returned')
      .reduce((sum, e) => sum + e.amount_cents, 0);
    
    const netLiability = totalCharged - totalReturned;
    
    const kegsOut = entries
      .filter(e => e.direction === 'charged')
      .reduce((sum, e) => sum + e.qty, 0) -
      entries
      .filter(e => e.direction === 'returned')
      .reduce((sum, e) => sum + e.qty, 0);

    return {
      totalCharged,
      totalReturned,
      netLiability,
      kegsOut,
    };
  };

  const metrics = calculateMetrics();

  useEffect(() => {
    loadEntries();
    loadCustomers();
  }, [selectedPeriod]);

  const loadEntries = async () => {
    setLoading(true);
    try {
      let startDate: Date;
      let endDate: Date = new Date();

      switch (selectedPeriod) {
        case 'current':
          startDate = startOfMonth(new Date());
          endDate = endOfMonth(new Date());
          break;
        case 'last30':
          startDate = subMonths(new Date(), 1);
          break;
        case 'last90':
          startDate = subMonths(new Date(), 3);
          break;
        case 'ytd':
          startDate = new Date(new Date().getFullYear(), 0, 1);
          break;
        default:
          startDate = subMonths(new Date(), 1);
      }

      const { data, error } = await supabase
        .from('keg_deposit_entries')
        .select(`
          *,
          customers:customer_id (
            id,
            name
          ),
          finished_skus:sku_id (
            id,
            code,
            name
          )
        `)
        .eq('workspace_id', workspaceId)
        .gte('entry_date', startDate.toISOString().split('T')[0])
        .lte('entry_date', endDate.toISOString().split('T')[0])
        .order('entry_date', { ascending: false });

      if (error) throw error;

      // Transform the data
      const transformedEntries = data?.map(entry => ({
        id: entry.id,
        customer_id: entry.customer_id,
        customer_name: entry.customers?.name,
        sku_id: entry.sku_id,
        sku_name: entry.finished_skus?.name || entry.finished_skus?.code,
        entry_date: new Date(entry.entry_date),
        qty: entry.qty,
        amount_cents: entry.amount_cents,
        direction: entry.direction,
        reference_doc: entry.reference_doc,
        notes: entry.notes,
        created_at: new Date(entry.created_at),
      })) || [];

      setEntries(transformedEntries);
    } catch (error) {
      console.error('Error loading keg deposits:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCustomers = async () => {
    try {
      // In a real app, this would be a view or RPC that calculates balances
      const { data } = await supabase
        .from('keg_deposit_entries')
        .select('customer_id, qty, amount_cents, direction')
        .eq('workspace_id', workspaceId);

      // Calculate balances per customer
      const customerMap = new Map<string, Customer>();
      
      data?.forEach(entry => {
        if (!entry.customer_id) return;
        
        const existing = customerMap.get(entry.customer_id) || {
          id: entry.customer_id,
          name: 'Customer', // Would be joined from customers table
          balance_cents: 0,
          kegs_out: 0,
        };

        if (entry.direction === 'charged') {
          existing.balance_cents += entry.amount_cents;
          existing.kegs_out += entry.qty;
        } else {
          existing.balance_cents -= entry.amount_cents;
          existing.kegs_out -= entry.qty;
        }

        customerMap.set(entry.customer_id, existing);
      });

      setCustomers(Array.from(customerMap.values()));
    } catch (error) {
      console.error('Error loading customer balances:', error);
    }
  };

  const handleAddEntry = async () => {
    try {
      const { error } = await supabase
        .from('keg_deposit_entries')
        .insert({
          workspace_id: workspaceId,
          customer_id: newEntry.customer_id || null,
          sku_id: newEntry.sku_id || null,
          entry_date: new Date().toISOString().split('T')[0],
          qty: newEntry.qty,
          amount_cents: Math.round(newEntry.amount * 100),
          direction: newEntry.direction,
          reference_doc: newEntry.reference_doc,
          notes: newEntry.notes,
        });

      if (error) throw error;

      // Refresh the list
      await loadEntries();
      await loadCustomers();
      
      // Reset form
      setNewEntry({
        customer_id: '',
        sku_id: '',
        qty: 1,
        amount: 50,
        direction: 'charged',
        reference_doc: '',
        notes: '',
      });
      setShowAddDialog(false);
    } catch (error) {
      console.error('Error adding deposit entry:', error);
      alert('Failed to add deposit entry');
    }
  };

  const exportToCSV = () => {
    const headers = ['Date', 'Customer', 'SKU', 'Quantity', 'Amount', 'Type', 'Reference', 'Notes'];
    const rows = entries.map(entry => [
      format(entry.entry_date, 'yyyy-MM-dd'),
      entry.customer_name || '',
      entry.sku_name || '',
      entry.qty.toString(),
      `$${(entry.amount_cents / 100).toFixed(2)}`,
      entry.direction === 'charged' ? 'Deposit Charged' : 'Deposit Returned',
      entry.reference_doc || '',
      entry.notes || '',
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `keg-deposits-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  const exportQBOFormat = () => {
    // Export in QuickBooks-compatible format
    const qboData = entries.map(entry => ({
      Date: format(entry.entry_date, 'MM/dd/yyyy'),
      Account: entry.direction === 'charged' ? 'Keg Deposit Liability' : 'Keg Deposit Liability',
      Debit: entry.direction === 'returned' ? (entry.amount_cents / 100).toFixed(2) : '',
      Credit: entry.direction === 'charged' ? (entry.amount_cents / 100).toFixed(2) : '',
      Name: entry.customer_name || '',
      Memo: `${entry.qty} keg(s) - ${entry.reference_doc || ''} ${entry.notes || ''}`.trim(),
    }));

    const headers = ['Date', 'Account', 'Debit', 'Credit', 'Name', 'Memo'];
    const rows = qboData.map(row => [
      row.Date,
      row.Account,
      row.Debit,
      row.Credit,
      row.Name,
      row.Memo,
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `keg-deposits-qbo-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Deposits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ${(metrics.totalCharged / 100).toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              <TrendingUp className="h-3 w-3 inline mr-1" />
              Charged to customers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Returns</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              ${(metrics.totalReturned / 100).toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              <TrendingDown className="h-3 w-3 inline mr-1" />
              Returned to customers
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Net Liability</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${(metrics.netLiability / 100).toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              <DollarSign className="h-3 w-3 inline mr-1" />
              Current deposit liability
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Kegs Outstanding</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.kegsOut}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              <Beer className="h-3 w-3 inline mr-1" />
              Currently with customers
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Keg Deposit Ledger</CardTitle>
              <CardDescription>Track deposit charges and returns</CardDescription>
            </div>
            <div className="flex gap-2">
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">Current Month</SelectItem>
                  <SelectItem value="last30">Last 30 Days</SelectItem>
                  <SelectItem value="last90">Last 90 Days</SelectItem>
                  <SelectItem value="ytd">Year to Date</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={exportToCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
              <Button variant="outline" onClick={exportQBOFormat}>
                <FileText className="h-4 w-4 mr-2" />
                Export QBO
              </Button>
              <Button onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Entry
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="transactions">
            <TabsList>
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
              <TabsTrigger value="customers">Customer Balances</TabsTrigger>
            </TabsList>

            <TabsContent value="transactions">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map(entry => (
                    <TableRow key={entry.id}>
                      <TableCell>{format(entry.entry_date, 'MMM dd, yyyy')}</TableCell>
                      <TableCell>{entry.customer_name || '-'}</TableCell>
                      <TableCell>{entry.sku_name || '-'}</TableCell>
                      <TableCell className="text-center">{entry.qty}</TableCell>
                      <TableCell className="text-right font-mono">
                        ${(entry.amount_cents / 100).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {entry.direction === 'charged' ? (
                          <Badge variant="success">Charged</Badge>
                        ) : (
                          <Badge variant="secondary">Returned</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{entry.reference_doc || '-'}</TableCell>
                      <TableCell className="text-sm">{entry.notes || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="customers">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-center">Kegs Out</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map(customer => (
                    <TableRow key={customer.id}>
                      <TableCell className="font-medium">{customer.name}</TableCell>
                      <TableCell className="text-center">{customer.kegs_out}</TableCell>
                      <TableCell className="text-right font-mono">
                        ${(customer.balance_cents / 100).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {customer.balance_cents > 0 ? (
                          <Badge variant="warning">Outstanding</Badge>
                        ) : (
                          <Badge variant="success">Clear</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Add Entry Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Deposit Entry</DialogTitle>
            <DialogDescription>
              Record a keg deposit charge or return
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label>Transaction Type</Label>
              <Select 
                value={newEntry.direction} 
                onValueChange={(value) => setNewEntry({...newEntry, direction: value as 'charged' | 'returned'})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="charged">Deposit Charged</SelectItem>
                  <SelectItem value="returned">Deposit Returned</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Customer</Label>
              <Input
                placeholder="Customer name or ID"
                value={newEntry.customer_id}
                onChange={(e) => setNewEntry({...newEntry, customer_id: e.target.value})}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Quantity (Kegs)</Label>
                <Input
                  type="number"
                  min="1"
                  value={newEntry.qty}
                  onChange={(e) => setNewEntry({...newEntry, qty: parseInt(e.target.value) || 1})}
                />
              </div>
              <div>
                <Label>Amount per Keg ($)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={newEntry.amount}
                  onChange={(e) => setNewEntry({...newEntry, amount: parseFloat(e.target.value) || 0})}
                />
              </div>
            </div>

            <div>
              <Label>Reference Document</Label>
              <Input
                placeholder="Invoice #, PO #, etc."
                value={newEntry.reference_doc}
                onChange={(e) => setNewEntry({...newEntry, reference_doc: e.target.value})}
              />
            </div>

            <div>
              <Label>Notes</Label>
              <Input
                placeholder="Additional notes"
                value={newEntry.notes}
                onChange={(e) => setNewEntry({...newEntry, notes: e.target.value})}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddEntry}>
              Add Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}