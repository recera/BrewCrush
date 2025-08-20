'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Download, FileText, FileSpreadsheet } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

interface ExportControlsProps {
  reportType: string
  filters?: Record<string, any>
  sort?: {
    field: string
    direction: 'asc' | 'desc'
  }
  entityType?: string
  entityId?: string
  direction?: string
}

export function ExportControls({
  reportType,
  filters = {},
  sort = { field: 'created_at', direction: 'desc' },
  entityType,
  entityId,
  direction
}: ExportControlsProps) {
  const [exporting, setExporting] = useState(false)
  const [exportFormat, setExportFormat] = useState<'csv' | 'pdf'>('csv')
  
  const supabase = createClient()
  const { toast } = useToast()

  const exportReport = async (format: 'csv' | 'pdf') => {
    setExporting(true)
    
    try {
      // Get the current session to include in the request
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        throw new Error('You must be logged in to export reports')
      }

      // Prepare the request body based on report type
      let requestBody: any = {
        filters,
        sort
      }

      // Special handling for recall drill reports
      if (reportType === 'recall_drill') {
        if (!entityType || !entityId) {
          throw new Error('Entity type and ID are required for recall drill export')
        }
        requestBody = {
          entity_type: entityType,
          entity_id: entityId,
          direction: direction || 'both'
        }
      }

      // Make the request to the Edge Function
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-reports?type=${reportType}&format=${format}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody)
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Export failed' }))
        throw new Error(errorData.error || 'Export failed')
      }

      // Handle the response based on format
      if (format === 'csv' || format === 'pdf') {
        // Get the filename from headers
        const contentDisposition = response.headers.get('Content-Disposition')
        let filename = `${reportType}_export_${Date.now()}.${format}`
        
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename="([^"]*)"/)
          if (filenameMatch) {
            filename = filenameMatch[1]
          }
        }

        // Download the file
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.appendChild(link)
        link.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(link)

        toast({
          title: 'Export successful',
          description: `Report exported as ${format.toUpperCase()} file.`,
        })
      }

    } catch (error: any) {
      console.error('Export error:', error)
      toast({
        title: 'Export failed',
        description: error.message || 'An error occurred while exporting the report.',
        variant: 'destructive',
      })
    } finally {
      setExporting(false)
    }
  }

  const formatLabels = {
    csv: 'CSV (Spreadsheet)',
    pdf: 'PDF (Document)'
  }

  return (
    <div className="flex items-center space-x-2">
      {/* Format selector */}
      <Select
        value={exportFormat}
        onValueChange={(value: 'csv' | 'pdf') => setExportFormat(value)}
      >
        <SelectTrigger className="w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="csv">
            <div className="flex items-center space-x-2">
              <FileSpreadsheet className="h-4 w-4" />
              <span>CSV</span>
            </div>
          </SelectItem>
          <SelectItem value="pdf">
            <div className="flex items-center space-x-2">
              <FileText className="h-4 w-4" />
              <span>PDF</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>

      {/* Export button */}
      <Button
        onClick={() => exportReport(exportFormat)}
        disabled={exporting}
        className="flex items-center space-x-2"
      >
        <Download className={`h-4 w-4 ${exporting ? 'animate-bounce' : ''}`} />
        <span>{exporting ? 'Exporting...' : 'Export'}</span>
      </Button>

      {/* Quick export dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={exporting}>
            <Download className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => exportReport('csv')}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Export as CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportReport('pdf')}>
            <FileText className="h-4 w-4 mr-2" />
            Export as PDF
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// Helper function to download data as CSV (fallback for direct client-side export)
export function downloadAsCSV(data: any[], filename: string) {
  if (!data || data.length === 0) {
    return
  }

  // Generate CSV content
  const headers = Object.keys(data[0])
  const csvContent = [
    headers.join(','), // Header row
    ...data.map(row => 
      headers.map(header => {
        const value = row[header]
        // Handle null/undefined values and escape commas/quotes
        if (value === null || value === undefined) return ''
        const stringValue = String(value)
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`
        }
        return stringValue
      }).join(',')
    )
  ].join('\n')

  // Create and download the file
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}