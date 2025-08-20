'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import { Button } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Alert, AlertDescription } from '@brewcrush/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@brewcrush/ui';
import { 
  DollarSign, 
  Download, 
  Calculator,
  FileText,
  Info,
  TrendingUp
} from 'lucide-react';
import { format } from 'date-fns';
import { useSupabase } from '@/hooks/useSupabase';

interface ExciseWorksheetProps {
  workspaceId: string;
  currentPeriod: {
    frequency: 'semi_monthly' | 'quarterly' | 'annual';
    start: Date;
    end: Date;
    dueDate: Date;
    status: 'open' | 'draft' | 'finalized';
  };
}

interface RateBand {
  band: string;
  rate_cents: number;
  qty_bbl: number;
  tax_cents: number;
}

export function ExciseWorksheet({ workspaceId, currentPeriod }: ExciseWorksheetProps) {
  const supabase = useSupabase();
  const [isCalculating, setIsCalculating] = useState(false);

  // Mock data - would be fetched from API
  const worksheetData = {
    net_taxable_bbl: 456.78,
    ytd_cbma_used: 15234,
    cbma_remaining: 44766,
    rate_bands: [
      { band: 'first_60k', rate_cents: 350, qty_bbl: 456.78, tax_cents: 159873 }
    ] as RateBand[],
    total_tax_cents: 159873,
    removals: [
      { date: '2025-01-15', destination: 'Distributor', barrels: 234.56, taxable: true },
      { date: '2025-01-20', destination: 'Taproom', barrels: 45.67, taxable: true },
      { date: '2025-01-25', destination: 'Distributor', barrels: 189.45, taxable: true },
      { date: '2025-01-28', destination: 'Export', barrels: 12.34, taxable: false },
      { date: '2025-01-30', destination: 'Returns', barrels: -12.90, taxable: true }
    ]
  };

  const handleGenerateWorksheet = async () => {
    setIsCalculating(true);
    try {
      const { data, error } = await supabase.rpc('build_excise_worksheet', {
        p_period_start: currentPeriod.start.toISOString(),
        p_period_end: currentPeriod.end.toISOString(),
        p_workspace_id: workspaceId,
        p_dry_run: false
      });

      if (error) throw error;
      
      console.log('Worksheet generated:', data);
    } catch (error) {
      console.error('Error generating excise worksheet:', error);
    } finally {
      setIsCalculating(false);
    }
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(cents / 100);
  };

  const getRateBandLabel = (band: string) => {
    const labels: Record<string, string> = {
      'first_60k': 'First 60,000 BBL ($3.50/BBL)',
      '60k_to_6m': '60,001 to 6,000,000 BBL ($16.00/BBL)',
      'over_6m': 'Over 6,000,000 BBL ($18.00/BBL)'
    };
    return labels[band] || band;
  };

  const getFrequencyLabel = (frequency: string) => {
    const labels: Record<string, string> = {
      'semi_monthly': 'Semi-Monthly',
      'quarterly': 'Quarterly',
      'annual': 'Annual'
    };
    return labels[frequency] || frequency;
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Excise Tax Return Worksheet</CardTitle>
              <CardDescription>
                TTB Form 5000.24 - {getFrequencyLabel(currentPeriod.frequency)} Return
              </CardDescription>
            </div>
            <Badge variant="secondary">
              Period: {format(currentPeriod.start, 'MMM dd')} - {format(currentPeriod.end, 'MMM dd, yyyy')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button 
              onClick={handleGenerateWorksheet}
              disabled={isCalculating}
            >
              <Calculator className="h-4 w-4 mr-2" />
              {isCalculating ? 'Calculating...' : 'Generate Worksheet'}
            </Button>
            <Button variant="secondary">
              <Download className="h-4 w-4 mr-2" />
              Export for Pay.gov
            </Button>
            <Button variant="secondary">
              <FileText className="h-4 w-4 mr-2" />
              View Instructions
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tax Calculation Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Net Taxable Removals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{worksheetData.net_taxable_bbl.toFixed(2)} BBL</div>
            <p className="text-xs text-muted-foreground mt-1">
              Removals minus returns
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">CBMA Allocation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {worksheetData.ytd_cbma_used.toLocaleString()} / 60,000
            </div>
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs">
                <span>Remaining this year:</span>
                <span className="font-semibold">{worksheetData.cbma_remaining.toLocaleString()} BBL</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                <div 
                  className="bg-blue-600 h-2 rounded-full" 
                  style={{ width: `${(worksheetData.ytd_cbma_used / 60000) * 100}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Tax Due</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(worksheetData.total_tax_cents)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Due by {format(currentPeriod.dueDate, 'MMM dd, yyyy')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* CBMA Rate Bands */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tax Calculation by Rate Band</CardTitle>
          <CardDescription>
            Craft Beverage Modernization Act (CBMA) reduced rates applied
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rate Band</TableHead>
                <TableHead className="text-right">Barrels</TableHead>
                <TableHead className="text-right">Rate per BBL</TableHead>
                <TableHead className="text-right">Tax Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {worksheetData.rate_bands.map((band, index) => (
                <TableRow key={index}>
                  <TableCell>{getRateBandLabel(band.band)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {band.qty_bbl.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(band.rate_cents)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatCurrency(band.tax_cents)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2">
                <TableCell colSpan={3} className="font-semibold">Total Tax Due</TableCell>
                <TableCell className="text-right font-mono font-bold text-lg">
                  {formatCurrency(worksheetData.total_tax_cents)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Removals Detail */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Removals Detail</CardTitle>
          <CardDescription>
            All removals and returns for the period
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead className="text-right">Barrels</TableHead>
                <TableHead>Tax Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {worksheetData.removals.map((removal, index) => (
                <TableRow key={index}>
                  <TableCell>{removal.date}</TableCell>
                  <TableCell>{removal.destination}</TableCell>
                  <TableCell className="text-right font-mono">
                    {removal.barrels > 0 ? '' : '('}{Math.abs(removal.barrels).toFixed(2)}{removal.barrels > 0 ? '' : ')'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={removal.taxable ? 'default' : 'secondary'}>
                      {removal.taxable ? 'Taxable' : 'Non-Taxable'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Instructions Alert */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>Filing Instructions:</strong> After generating your worksheet, log in to Pay.gov to submit your TTB F 5000.24. 
          The worksheet provides all necessary calculations for Line 11 (Beer) and supporting schedules. 
          Remember to include your return serial number, which begins with the current year.
        </AlertDescription>
      </Alert>
    </div>
  );
}