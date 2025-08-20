'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@brewcrush/ui';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@brewcrush/ui';
import { Badge } from '@brewcrush/ui';
import { Button } from '@brewcrush/ui';
import { Alert, AlertDescription, AlertTitle } from '@brewcrush/ui';
import { 
  FileText, 
  DollarSign, 
  Truck, 
  AlertTriangle,
  Calendar,
  Download,
  CheckCircle2,
  Beer
} from 'lucide-react';
import { format, addDays, isPast } from 'date-fns';
import { BROPManager } from './BROPManager';
import { ExciseWorksheet } from './ExciseWorksheet';
import { TransfersInBond } from './TransfersInBond';
import { SalesIngest } from './SalesIngest';
import { KegDepositLedger } from './KegDepositLedger';

interface ComplianceCenterProps {
  workspaceId: string;
}

export function ComplianceCenter({ workspaceId }: ComplianceCenterProps) {
  const [activeTab, setActiveTab] = useState('brop');
  
  // These would be fetched from the API
  const currentPeriod = {
    type: 'monthly' as const,
    start: new Date('2025-01-01'),
    end: new Date('2025-01-31'),
    dueDate: addDays(new Date('2025-01-31'), 15),
    status: 'open' as const
  };
  
  const excisePeriod = {
    frequency: 'quarterly' as const,
    start: new Date('2025-01-01'),
    end: new Date('2025-03-31'),
    dueDate: addDays(new Date('2025-03-31'), 14),
    status: 'draft' as const
  };

  const isDueSoon = (date: Date) => {
    const daysUntilDue = Math.ceil((date.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilDue <= 7 && daysUntilDue >= 0;
  };

  const isOverdue = (date: Date) => isPast(date);

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header with Due Date Alerts */}
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold">Compliance Center</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* BROP Due Date Alert */}
          <Alert className={isOverdue(currentPeriod.dueDate) ? 'border-red-500' : isDueSoon(currentPeriod.dueDate) ? 'border-yellow-500' : ''}>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>BROP {currentPeriod.type === 'monthly' ? 'Monthly' : 'Quarterly'} Report</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>Period: {format(currentPeriod.start, 'MMM dd')} - {format(currentPeriod.end, 'MMM dd, yyyy')}</span>
              <Badge variant={isOverdue(currentPeriod.dueDate) ? 'destructive' : isDueSoon(currentPeriod.dueDate) ? 'warning' : 'secondary'}>
                Due: {format(currentPeriod.dueDate, 'MMM dd, yyyy')}
              </Badge>
            </AlertDescription>
          </Alert>

          {/* Excise Due Date Alert */}
          <Alert className={isOverdue(excisePeriod.dueDate) ? 'border-red-500' : isDueSoon(excisePeriod.dueDate) ? 'border-yellow-500' : ''}>
            <DollarSign className="h-4 w-4" />
            <AlertTitle>Excise Tax Return (F 5000.24)</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>Period: {format(excisePeriod.start, 'MMM dd')} - {format(excisePeriod.end, 'MMM dd, yyyy')}</span>
              <Badge variant={isOverdue(excisePeriod.dueDate) ? 'destructive' : isDueSoon(excisePeriod.dueDate) ? 'warning' : 'secondary'}>
                Due: {format(excisePeriod.dueDate, 'MMM dd, yyyy')}
              </Badge>
            </AlertDescription>
          </Alert>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="brop" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            BROP
          </TabsTrigger>
          <TabsTrigger value="excise" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Excise
          </TabsTrigger>
          <TabsTrigger value="transfers" className="flex items-center gap-2">
            <Truck className="h-4 w-4" />
            Transfers
          </TabsTrigger>
          <TabsTrigger value="sales" className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Sales Ingest
          </TabsTrigger>
          <TabsTrigger value="keg-deposits" className="flex items-center gap-2">
            <Beer className="h-4 w-4" />
            Keg Deposits
          </TabsTrigger>
        </TabsList>

        <TabsContent value="brop" className="space-y-4">
          <BROPManager 
            workspaceId={workspaceId}
            currentPeriod={currentPeriod}
          />
        </TabsContent>

        <TabsContent value="excise" className="space-y-4">
          <ExciseWorksheet
            workspaceId={workspaceId}
            currentPeriod={excisePeriod}
          />
        </TabsContent>

        <TabsContent value="transfers" className="space-y-4">
          <TransfersInBond
            workspaceId={workspaceId}
          />
        </TabsContent>

        <TabsContent value="sales" className="space-y-4">
          <SalesIngest
            workspaceId={workspaceId}
          />
        </TabsContent>

        <TabsContent value="keg-deposits" className="space-y-4">
          <KegDepositLedger
            workspaceId={workspaceId}
          />
        </TabsContent>
      </Tabs>

      {/* Quick Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Opening Balance</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">1,234.56 BBL</div>
            <p className="text-xs text-muted-foreground">From prior period</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Taxable</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">456.78 BBL</div>
            <p className="text-xs text-muted-foreground">This period</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">CBMA Used</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">15,234 / 60,000</div>
            <p className="text-xs text-muted-foreground">BBL at reduced rate</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Estimated Tax</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$1,598.73</div>
            <p className="text-xs text-muted-foreground">Due {format(excisePeriod.dueDate, 'MMM dd')}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}