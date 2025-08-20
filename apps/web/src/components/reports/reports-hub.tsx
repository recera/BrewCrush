'use client'

import { useState } from 'react'
import { 
  Package, 
  FlaskConical, 
  FileText, 
  TrendingUp, 
  Search,
  AlertTriangle,
  DollarSign,
  BarChart3
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { InventoryReport } from './inventory-report'
import { BatchSummaryReport } from './batch-summary-report'
import { POAgingReport } from './po-aging-report'
import { RecallDrillReport } from './recall-drill-report'
import { SupplierTrendsReport } from './supplier-trends-report'
import { KegDepositReport } from './keg-deposit-report'

interface ReportCard {
  id: string
  title: string
  description: string
  icon: React.ComponentType<any>
  color: string
  category: 'inventory' | 'production' | 'purchasing' | 'compliance'
}

const reportTypes: ReportCard[] = [
  {
    id: 'inventory',
    title: 'Inventory On-Hand',
    description: 'Current stock levels, values, and lot details',
    icon: Package,
    color: 'bg-blue-50 border-blue-200 hover:border-blue-300',
    category: 'inventory'
  },
  {
    id: 'batch-summary',
    title: 'Batch Summary',
    description: 'Production yields, costs, and quality metrics',
    icon: FlaskConical,
    color: 'bg-green-50 border-green-200 hover:border-green-300',
    category: 'production'
  },
  {
    id: 'po-aging',
    title: 'PO Aging',
    description: 'Purchase order status and aging analysis',
    icon: FileText,
    color: 'bg-orange-50 border-orange-200 hover:border-orange-300',
    category: 'purchasing'
  },
  {
    id: 'supplier-trends',
    title: 'Supplier Price Trends',
    description: 'Historical pricing and vendor performance',
    icon: TrendingUp,
    color: 'bg-purple-50 border-purple-200 hover:border-purple-300',
    category: 'purchasing'
  },
  {
    id: 'recall-drill',
    title: 'Recall Drill',
    description: 'Trace ingredients and finished products',
    icon: AlertTriangle,
    color: 'bg-red-50 border-red-200 hover:border-red-300',
    category: 'compliance'
  },
  {
    id: 'keg-deposits',
    title: 'Keg Deposit Ledger',
    description: 'Keg deposit tracking and liability',
    icon: DollarSign,
    color: 'bg-yellow-50 border-yellow-200 hover:border-yellow-300',
    category: 'inventory'
  }
]

export function ReportsHub() {
  const [activeReport, setActiveReport] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>('all')

  const categories = [
    { id: 'all', label: 'All Reports', icon: BarChart3 },
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'production', label: 'Production', icon: FlaskConical },
    { id: 'purchasing', label: 'Purchasing', icon: FileText },
    { id: 'compliance', label: 'Compliance', icon: AlertTriangle }
  ]

  const filteredReports = activeCategory === 'all' 
    ? reportTypes 
    : reportTypes.filter(report => report.category === activeCategory)

  if (activeReport) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          <Button 
            variant="ghost" 
            onClick={() => setActiveReport(null)}
            className="text-muted-foreground hover:text-foreground"
          >
            ← Back to Reports
          </Button>
          <h2 className="text-2xl font-semibold">
            {reportTypes.find(r => r.id === activeReport)?.title}
          </h2>
        </div>
        
        {activeReport === 'inventory' && <InventoryReport />}
        {activeReport === 'batch-summary' && <BatchSummaryReport />}
        {activeReport === 'po-aging' && <POAgingReport />}
        {activeReport === 'recall-drill' && <RecallDrillReport />}
        {activeReport === 'supplier-trends' && <SupplierTrendsReport />}
        {activeReport === 'keg-deposits' && <KegDepositReport />}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Category Filter */}
      <div className="flex space-x-2 overflow-x-auto pb-2">
        {categories.map((category) => {
          const Icon = category.icon
          return (
            <Button
              key={category.id}
              variant={activeCategory === category.id ? 'default' : 'outline'}
              onClick={() => setActiveCategory(category.id)}
              className="flex items-center space-x-2 whitespace-nowrap"
            >
              <Icon className="h-4 w-4" />
              <span>{category.label}</span>
            </Button>
          )
        })}
      </div>

      {/* Reports Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredReports.map((report) => {
          const Icon = report.icon
          return (
            <Card 
              key={report.id}
              className={`cursor-pointer transition-colors ${report.color}`}
              onClick={() => setActiveReport(report.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded-lg bg-white/80">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{report.title}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm">
                  {report.description}
                </CardDescription>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {filteredReports.length === 0 && (
        <div className="text-center py-12">
          <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No reports found</h3>
          <p className="text-muted-foreground">
            Try selecting a different category or contact support for additional reports.
          </p>
        </div>
      )}

      {/* Quick Info */}
      <div className="bg-muted/30 rounded-lg p-6">
        <h3 className="font-semibold mb-2">Report Features</h3>
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4 text-sm text-muted-foreground">
          <div className="flex items-center space-x-2">
            <div className="h-2 w-2 bg-green-500 rounded-full"></div>
            <span>Real-time data</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="h-2 w-2 bg-blue-500 rounded-full"></div>
            <span>CSV/PDF export</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="h-2 w-2 bg-purple-500 rounded-full"></div>
            <span>Saved views</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="h-2 w-2 bg-orange-500 rounded-full"></div>
            <span>Advanced filtering</span>
          </div>
        </div>
      </div>
    </div>
  )
}