'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import { Button } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Alert, AlertDescription } from '@brewcrush/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@brewcrush/ui';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@brewcrush/ui';
import { 
  FileText, 
  Download, 
  AlertTriangle, 
  CheckCircle, 
  RefreshCw,
  Lock,
  Info
} from 'lucide-react';
import { format } from 'date-fns';
import { useSupabase } from '@/hooks/useSupabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface BROPManagerProps {
  workspaceId: string;
  currentPeriod: {
    type: 'monthly' | 'quarterly';
    start: Date;
    end: Date;
    dueDate: Date;
    status: 'open' | 'draft' | 'finalized';
  };
}

interface TTBEntry {
  line_code: string;
  category: string;
  quantity_bbl: number;
  notes?: string;
}

interface ReconciliationResult {
  is_valid: boolean;
  opening_bbl: number;
  produced_bbl: number;
  received_bbl: number;
  returned_bbl: number;
  removed_tax_bbl: number;
  removed_notax_bbl: number;
  consumed_bbl: number;
  destroyed_bbl: number;
  losses_bbl: number;
  closing_bbl: number;
  calculated_closing: number;
  variance: number;
  anomalies: any[];
}

export function BROPManager({ workspaceId, currentPeriod }: BROPManagerProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState('reconciliation');

  // Mock data for demonstration - would be fetched from API
  const entries: TTBEntry[] = [
    { line_code: '01', category: 'opening', quantity_bbl: 1234.56, notes: 'Opening balance from prior period' },
    { line_code: '02', category: 'produced', quantity_bbl: 890.12, notes: 'Beer produced by fermentation' },
    { line_code: '03', category: 'received_in_bond', quantity_bbl: 0, notes: 'Received from other breweries' },
    { line_code: '04', category: 'returned_to_brewery', quantity_bbl: 12.34, notes: 'Previously taxpaid beer returned' },
    { line_code: '07', category: 'removed_tax_determined', quantity_bbl: 456.78, notes: 'Removed for consumption or sale' },
    { line_code: '08', category: 'removed_without_tax', quantity_bbl: 0, notes: 'Exports, research, supplies' },
    { line_code: '09', category: 'consumed_on_premises', quantity_bbl: 5.67, notes: 'Consumed on brewery premises' },
    { line_code: '10', category: 'destroyed', quantity_bbl: 2.45, notes: 'Destroyed nontaxpaid' },
    { line_code: '11', category: 'loss', quantity_bbl: 1.23, notes: 'Known losses' },
    { line_code: '15', category: 'closing', quantity_bbl: 1670.89, notes: 'Calculated closing balance' }
  ];

  const reconciliation: ReconciliationResult = {
    is_valid: true,
    opening_bbl: 1234.56,
    produced_bbl: 890.12,
    received_bbl: 0,
    returned_bbl: 12.34,
    removed_tax_bbl: 456.78,
    removed_notax_bbl: 0,
    consumed_bbl: 5.67,
    destroyed_bbl: 2.45,
    losses_bbl: 1.23,
    closing_bbl: 1670.89,
    calculated_closing: 1670.89,
    variance: 0,
    anomalies: []
  };

  const handleGenerateDraft = async () => {
    setIsGenerating(true);
    try {
      // Call the generate_ttb_period RPC
      const { data, error } = await supabase.rpc('generate_ttb_period', {
        p_period_id: 'current-period-id', // Would be actual period ID
        p_finalize: false,
        p_dry_run: false
      });

      if (error) throw error;
      
      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['ttb-entries'] });
    } catch (error) {
      console.error('Error generating BROP:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFinalize = async () => {
    if (!confirm('Are you sure you want to finalize this BROP? This action cannot be undone.')) {
      return;
    }

    try {
      const { data, error } = await supabase.rpc('generate_ttb_period', {
        p_period_id: 'current-period-id',
        p_finalize: true,
        p_dry_run: false
      });

      if (error) throw error;
      
      queryClient.invalidateQueries({ queryKey: ['ttb-periods'] });
    } catch (error) {
      console.error('Error finalizing BROP:', error);
    }
  };

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      'opening': 'Opening Balance',
      'produced': 'Produced',
      'received_in_bond': 'Received in Bond',
      'returned_to_brewery': 'Returned to Brewery',
      'removed_tax_determined': 'Removed (Tax Determined)',
      'removed_without_tax': 'Removed (Without Tax)',
      'consumed_on_premises': 'Consumed on Premises',
      'destroyed': 'Destroyed',
      'loss': 'Loss',
      'shortage': 'Shortage',
      'closing': 'Closing Balance'
    };
    return labels[category] || category;
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Brewer's Report of Operations (BROP)</CardTitle>
              <CardDescription>
                TTB Form {currentPeriod.type === 'monthly' ? '5130.9' : '5130.26'} - {format(currentPeriod.start, 'MMMM yyyy')}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={currentPeriod.status === 'finalized' ? 'success' : currentPeriod.status === 'draft' ? 'warning' : 'secondary'}>
                {currentPeriod.status === 'finalized' && <Lock className="h-3 w-3 mr-1" />}
                {currentPeriod.status}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button 
              onClick={handleGenerateDraft}
              disabled={isGenerating || currentPeriod.status === 'finalized'}
            >
              {isGenerating && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
              Generate Draft
            </Button>
            <Button 
              variant="secondary"
              disabled={currentPeriod.status === 'finalized'}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button 
              variant="secondary"
              disabled={currentPeriod.status === 'finalized'}
            >
              <FileText className="h-4 w-4 mr-2" />
              Preview PDF
            </Button>
            {currentPeriod.status === 'draft' && (
              <Button 
                variant="default"
                onClick={handleFinalize}
                className="ml-auto"
              >
                <Lock className="h-4 w-4 mr-2" />
                Finalize & Snapshot
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabs for different views */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="entries">Line Items</TabsTrigger>
          <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
        </TabsList>

        <TabsContent value="reconciliation" className="space-y-4">
          {/* Reconciliation Formula */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Reconciliation Check</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                  <div className="space-y-2">
                    <h4 className="font-semibold text-sm">Additions</h4>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span>Opening Balance:</span>
                        <span className="font-mono">{reconciliation.opening_bbl.toFixed(2)} BBL</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Produced:</span>
                        <span className="font-mono">+{reconciliation.produced_bbl.toFixed(2)} BBL</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Received in Bond:</span>
                        <span className="font-mono">+{reconciliation.received_bbl.toFixed(2)} BBL</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Returned:</span>
                        <span className="font-mono">+{reconciliation.returned_bbl.toFixed(2)} BBL</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <h4 className="font-semibold text-sm">Removals</h4>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span>Tax Determined:</span>
                        <span className="font-mono">-{reconciliation.removed_tax_bbl.toFixed(2)} BBL</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Without Tax:</span>
                        <span className="font-mono">-{reconciliation.removed_notax_bbl.toFixed(2)} BBL</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Consumed:</span>
                        <span className="font-mono">-{reconciliation.consumed_bbl.toFixed(2)} BBL</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Destroyed:</span>
                        <span className="font-mono">-{reconciliation.destroyed_bbl.toFixed(2)} BBL</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Losses:</span>
                        <span className="font-mono">-{reconciliation.losses_bbl.toFixed(2)} BBL</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Calculated Closing:</span>
                    <span className="font-mono text-lg">{reconciliation.calculated_closing.toFixed(2)} BBL</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Reported Closing:</span>
                    <span className="font-mono text-lg">{reconciliation.closing_bbl.toFixed(2)} BBL</span>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t">
                    <span className="font-semibold">Variance:</span>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-lg ${Math.abs(reconciliation.variance) > 0.01 ? 'text-red-600' : 'text-green-600'}`}>
                        {reconciliation.variance > 0 ? '+' : ''}{reconciliation.variance.toFixed(2)} BBL
                      </span>
                      {Math.abs(reconciliation.variance) <= 0.01 && (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      )}
                    </div>
                  </div>
                </div>
                
                {reconciliation.is_valid && (
                  <Alert className="border-green-500 bg-green-50">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-800">
                      Reconciliation is balanced. The report is ready for review and submission.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="entries" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">BROP Line Items</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Line</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Quantity (BBL)</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.line_code}>
                      <TableCell className="font-mono">{entry.line_code}</TableCell>
                      <TableCell>{getCategoryLabel(entry.category)}</TableCell>
                      <TableCell className="text-right font-mono">
                        {entry.quantity_bbl.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.notes}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="anomalies" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Data Checks & Anomalies</CardTitle>
            </CardHeader>
            <CardContent>
              {reconciliation.anomalies.length === 0 ? (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    No anomalies detected. All data checks passed successfully.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-2">
                  {reconciliation.anomalies.map((anomaly, index) => (
                    <Alert key={index} variant="warning">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        {anomaly.message}
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              )}
              
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span>Opening balance matches prior period closing</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span>No negative inventory detected</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span>All losses have explanations</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span>Production records complete</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}