/**
 * Reports Hub - Central location for all reporting functionality
 * Supports inventory, batch, production, PO aging, supplier trends, recall drill, and keg deposit reports
 */

import { Suspense } from 'react'
import { ReportsHub } from '@/components/reports/reports-hub'
import { LoadingSpinner } from '@brewcrush/ui'

export default function ReportsPage() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="text-muted-foreground">
            Generate detailed reports with filtering, export, and saved views
          </p>
        </div>
      </div>

      <Suspense fallback={<LoadingSpinner />}>
        <ReportsHub />
      </Suspense>
    </div>
  )
}