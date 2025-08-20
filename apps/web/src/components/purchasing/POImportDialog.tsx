'use client'

import { useState, useRef } from 'react'
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
import { Alert, AlertDescription } from '@brewcrush/ui/alert'
import { Progress } from '@brewcrush/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@brewcrush/ui/table'
import { Upload, FileText, AlertCircle, CheckCircle, Download, X } from 'lucide-react'
import { toast } from '@brewcrush/ui'

interface POImportDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

interface ImportRow {
  po_number: string
  vendor_name: string
  vendor_email?: string
  order_date: string
  due_date?: string
  terms?: string
  line_number: number
  item_name: string
  item_sku?: string
  quantity: number
  uom: string
  unit_cost: number
  notes?: string
}

interface ValidationError {
  row: number
  field: string
  message: string
}

export function POImportDialog({ isOpen, onClose, onSuccess }: POImportDialogProps) {
  const supabase = useSupabase()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [parsedData, setParsedData] = useState<ImportRow[]>([])
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [progress, setProgress] = useState(0)
  const [step, setStep] = useState<'upload' | 'validate' | 'import' | 'complete'>('upload')

  const downloadTemplate = () => {
    const template = [
      'PO Number,Vendor Name,Vendor Email,Order Date,Due Date,Terms,Line Number,Item Name,Item SKU,Quantity,UOM,Unit Cost,Notes',
      'PO-2025-001,Country Malt Group,orders@countrymalt.com,2025-01-20,2025-02-03,Net 30,1,2-Row Pale Malt,MALT-2ROW,1000,lb,0.65,First order',
      'PO-2025-001,Country Malt Group,orders@countrymalt.com,2025-01-20,2025-02-03,Net 30,2,Munich Malt,MALT-MUNICH,200,lb,0.85,',
    ].join('\n')

    const blob = new Blob([template], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'po_import_template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    if (selectedFile) {
      if (selectedFile.type !== 'text/csv' && !selectedFile.name.endsWith('.csv')) {
        toast.error('Please select a CSV file')
        return
      }
      setFile(selectedFile)
      parseCSV(selectedFile)
    }
  }

  const parseCSV = async (file: File) => {
    setStep('validate')
    setLoading(true)
    setErrors([])

    try {
      const text = await file.text()
      const lines = text.split('\n').filter(line => line.trim())
      const headers = lines[0].split(',').map(h => h.trim())
      
      // Validate headers
      const requiredHeaders = ['PO Number', 'Vendor Name', 'Order Date', 'Line Number', 'Item Name', 'Quantity', 'UOM', 'Unit Cost']
      const missingHeaders = requiredHeaders.filter(h => !headers.includes(h))
      
      if (missingHeaders.length > 0) {
        setErrors([{
          row: 0,
          field: 'headers',
          message: `Missing required columns: ${missingHeaders.join(', ')}`
        }])
        setLoading(false)
        return
      }

      // Parse data rows
      const data: ImportRow[] = []
      const validationErrors: ValidationError[] = []

      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i])
        
        if (values.length !== headers.length) {
          validationErrors.push({
            row: i + 1,
            field: 'format',
            message: 'Column count mismatch'
          })
          continue
        }

        const row: any = {}
        headers.forEach((header, index) => {
          const value = values[index]?.trim()
          
          // Map headers to field names
          switch (header) {
            case 'PO Number': row.po_number = value; break
            case 'Vendor Name': row.vendor_name = value; break
            case 'Vendor Email': row.vendor_email = value; break
            case 'Order Date': row.order_date = value; break
            case 'Due Date': row.due_date = value; break
            case 'Terms': row.terms = value; break
            case 'Line Number': row.line_number = parseInt(value) || 0; break
            case 'Item Name': row.item_name = value; break
            case 'Item SKU': row.item_sku = value; break
            case 'Quantity': row.quantity = parseFloat(value) || 0; break
            case 'UOM': row.uom = value; break
            case 'Unit Cost': row.unit_cost = parseFloat(value) || 0; break
            case 'Notes': row.notes = value; break
          }
        })

        // Validate required fields
        if (!row.po_number) {
          validationErrors.push({ row: i + 1, field: 'PO Number', message: 'Required' })
        }
        if (!row.vendor_name) {
          validationErrors.push({ row: i + 1, field: 'Vendor Name', message: 'Required' })
        }
        if (!row.order_date) {
          validationErrors.push({ row: i + 1, field: 'Order Date', message: 'Required' })
        }
        if (!row.item_name) {
          validationErrors.push({ row: i + 1, field: 'Item Name', message: 'Required' })
        }
        if (row.quantity <= 0) {
          validationErrors.push({ row: i + 1, field: 'Quantity', message: 'Must be greater than 0' })
        }
        if (row.unit_cost < 0) {
          validationErrors.push({ row: i + 1, field: 'Unit Cost', message: 'Cannot be negative' })
        }

        data.push(row as ImportRow)
      }

      setParsedData(data)
      setErrors(validationErrors)
      
      if (validationErrors.length === 0) {
        toast.success(`Validated ${data.length} rows successfully`)
      } else {
        toast.warning(`Found ${validationErrors.length} validation errors`)
      }
    } catch (error) {
      console.error('Error parsing CSV:', error)
      toast.error('Failed to parse CSV file')
    } finally {
      setLoading(false)
    }
  }

  const parseCSVLine = (line: string): string[] => {
    const result = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current)
        current = ''
      } else {
        current += char
      }
    }
    
    result.push(current)
    return result
  }

  const handleImport = async () => {
    if (errors.length > 0) {
      toast.error('Please fix validation errors before importing')
      return
    }

    setStep('import')
    setLoading(true)
    setProgress(0)

    try {
      // Group rows by PO number
      const poGroups = parsedData.reduce((acc, row) => {
        if (!acc[row.po_number]) {
          acc[row.po_number] = {
            vendor_name: row.vendor_name,
            vendor_email: row.vendor_email,
            order_date: row.order_date,
            due_date: row.due_date,
            terms: row.terms,
            lines: []
          }
        }
        acc[row.po_number].lines.push({
          line_number: row.line_number,
          item_name: row.item_name,
          item_sku: row.item_sku,
          quantity: row.quantity,
          uom: row.uom,
          unit_cost: row.unit_cost,
          notes: row.notes
        })
        return acc
      }, {} as Record<string, any>)

      const totalPOs = Object.keys(poGroups).length
      let processed = 0

      // Process each PO
      for (const [po_number, poData] of Object.entries(poGroups)) {
        // First, ensure vendor exists
        let { data: vendor } = await supabase
          .from('vendors')
          .select('id')
          .eq('name', poData.vendor_name)
          .single()

        if (!vendor) {
          // Create vendor if it doesn't exist
          const { data: newVendor, error: vendorError } = await supabase
            .from('vendors')
            .insert({
              name: poData.vendor_name,
              email: poData.vendor_email,
              terms: poData.terms
            })
            .select('id')
            .single()

          if (vendorError) {
            throw new Error(`Failed to create vendor: ${vendorError.message}`)
          }
          vendor = newVendor
        }

        // Prepare lines for the PO
        const lines = []
        for (const line of poData.lines) {
          // Find or create item
          let { data: item } = await supabase
            .from('items')
            .select('id')
            .eq('name', line.item_name)
            .single()

          if (!item) {
            const { data: newItem, error: itemError } = await supabase
              .from('items')
              .insert({
                name: line.item_name,
                sku: line.item_sku,
                type: 'raw',
                uom: line.uom,
                vendor_id: vendor.id
              })
              .select('id')
              .single()

            if (itemError) {
              throw new Error(`Failed to create item: ${itemError.message}`)
            }
            item = newItem
          }

          lines.push({
            item_id: item.id,
            qty: line.quantity,
            uom: line.uom,
            expected_unit_cost: line.unit_cost,
            line_number: line.line_number || lines.length + 1,
            notes: line.notes
          })
        }

        // Create the PO
        const { error: poError } = await supabase.rpc('create_purchase_order', {
          p_vendor_id: vendor.id,
          p_due_date: poData.due_date || null,
          p_terms: poData.terms || null,
          p_notes: `Imported from CSV: ${po_number}`,
          p_lines: lines
        })

        if (poError) {
          throw new Error(`Failed to create PO ${po_number}: ${poError.message}`)
        }

        processed++
        setProgress((processed / totalPOs) * 100)
      }

      setStep('complete')
      toast.success(`Successfully imported ${totalPOs} purchase order(s)`)
      setTimeout(() => {
        onSuccess()
        handleClose()
      }, 2000)
    } catch (error: any) {
      console.error('Import error:', error)
      toast.error(error.message || 'Failed to import purchase orders')
      setStep('validate')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setFile(null)
    setParsedData([])
    setErrors([])
    setProgress(0)
    setStep('upload')
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Purchase Orders</DialogTitle>
          <DialogDescription>
            Upload a CSV file to import multiple purchase orders at once
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {step === 'upload' && (
            <>
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="mb-2">Drag and drop a CSV file here, or</p>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Select File
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <p className="text-sm text-muted-foreground mt-4">
                  Only CSV files are supported
                </p>
              </div>

              <Alert>
                <FileText className="h-4 w-4" />
                <AlertDescription>
                  Need a template? 
                  <Button
                    variant="link"
                    className="px-1"
                    onClick={downloadTemplate}
                  >
                    Download CSV template
                  </Button>
                  with the required format
                </AlertDescription>
              </Alert>
            </>
          )}

          {(step === 'validate' || step === 'import') && file && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  <span className="font-medium">{file.name}</span>
                  <span className="text-sm text-muted-foreground">
                    ({parsedData.length} rows)
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFile(null)
                    setParsedData([])
                    setErrors([])
                    setStep('upload')
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-medium mb-2">Validation Errors:</p>
                    <ul className="list-disc pl-4 space-y-1">
                      {errors.slice(0, 5).map((error, index) => (
                        <li key={index} className="text-sm">
                          Row {error.row}, {error.field}: {error.message}
                        </li>
                      ))}
                      {errors.length > 5 && (
                        <li className="text-sm">
                          ...and {errors.length - 5} more errors
                        </li>
                      )}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {parsedData.length > 0 && errors.length === 0 && (
                <Alert>
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertDescription>
                    All rows validated successfully. Ready to import.
                  </AlertDescription>
                </Alert>
              )}

              {step === 'import' && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Importing purchase orders...
                  </p>
                  <Progress value={progress} />
                </div>
              )}

              {/* Preview table */}
              {parsedData.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>PO Number</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Unit Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedData.slice(0, 5).map((row, index) => (
                        <TableRow key={index}>
                          <TableCell>{row.po_number}</TableCell>
                          <TableCell>{row.vendor_name}</TableCell>
                          <TableCell>{row.item_name}</TableCell>
                          <TableCell>{row.quantity} {row.uom}</TableCell>
                          <TableCell>${row.unit_cost.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                      {parsedData.length > 5 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground">
                            ...and {parsedData.length - 5} more rows
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          {step === 'complete' && (
            <Alert>
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription>
                Import completed successfully!
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          {step === 'validate' && parsedData.length > 0 && errors.length === 0 && (
            <Button onClick={handleImport} disabled={loading}>
              {loading ? 'Importing...' : 'Import POs'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}