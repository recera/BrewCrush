// Edge Function for Report Generation and Export
// Supports CSV and PDF export for various report types

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// CSV generation utilities
function escapeCSVField(field: any): string {
  if (field === null || field === undefined) {
    return ''
  }
  
  const str = String(field)
  
  // If field contains comma, quotes, or newlines, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  
  return str
}

function generateCSV(data: any[], reportType: string): string {
  if (!data || data.length === 0) {
    return 'No data available'
  }

  // Define column configurations for different report types
  const columnConfigs = {
    inventory: [
      { key: 'item_name', label: 'Item Name' },
      { key: 'item_type', label: 'Type' },
      { key: 'location_name', label: 'Location' },
      { key: 'total_qty', label: 'Quantity' },
      { key: 'base_uom', label: 'Unit' },
      { key: 'lot_count', label: 'Lots' },
      { key: 'avg_unit_cost', label: 'Avg Cost' },
      { key: 'total_value', label: 'Total Value' },
      { key: 'earliest_expiry', label: 'Earliest Expiry' },
      { key: 'below_reorder_level', label: 'Below Reorder' }
    ],
    batch_summary: [
      { key: 'batch_number', label: 'Batch Number' },
      { key: 'recipe_name', label: 'Recipe' },
      { key: 'style', label: 'Style' },
      { key: 'status', label: 'Status' },
      { key: 'brew_date', label: 'Brew Date' },
      { key: 'target_volume', label: 'Target Volume (L)' },
      { key: 'actual_volume', label: 'Actual Volume (L)' },
      { key: 'packaged_liters', label: 'Packaged (L)' },
      { key: 'yield_percentage', label: 'Yield %' },
      { key: 'og_target', label: 'OG Target' },
      { key: 'og_actual', label: 'OG Actual' },
      { key: 'fg_actual', label: 'FG Actual' },
      { key: 'abv_actual', label: 'ABV %' },
      { key: 'ingredient_cost', label: 'Ingredient Cost' },
      { key: 'packaging_cost', label: 'Packaging Cost' },
      { key: 'total_cost', label: 'Total Cost' },
      { key: 'cost_per_liter', label: 'Cost/Liter' },
      { key: 'total_duration_days', label: 'Duration (days)' }
    ],
    po_aging: [
      { key: 'po_number', label: 'PO Number' },
      { key: 'vendor_name', label: 'Vendor' },
      { key: 'status', label: 'Status' },
      { key: 'order_date', label: 'Order Date' },
      { key: 'expected_delivery_date', label: 'Expected Delivery' },
      { key: 'days_since_order', label: 'Days Since Order' },
      { key: 'days_overdue', label: 'Days Overdue' },
      { key: 'total_value', label: 'Total Value' },
      { key: 'received_value', label: 'Received Value' },
      { key: 'outstanding_value', label: 'Outstanding Value' },
      { key: 'completion_pct', label: 'Completion %' },
      { key: 'age_category', label: 'Age Category' }
    ],
    recall_drill: [
      { key: 'trace_direction', label: 'Direction' },
      { key: 'level_type', label: 'Level' },
      { key: 'level_number', label: 'Level #' },
      { key: 'entity_type', label: 'Entity Type' },
      { key: 'entity_name', label: 'Entity Name' },
      { key: 'relationship_type', label: 'Relationship' },
      { key: 'quantity', label: 'Quantity' },
      { key: 'uom', label: 'Unit' },
      { key: 'date_related', label: 'Date' },
      { key: 'risk_level', label: 'Risk Level' }
    ]
  }

  const columns = columnConfigs[reportType as keyof typeof columnConfigs] || 
    Object.keys(data[0]).map(key => ({ key, label: key }))

  // Generate header
  const header = columns.map(col => escapeCSVField(col.label)).join(',')
  
  // Generate data rows
  const rows = data.map(row => 
    columns.map(col => {
      let value = row[col.key]
      
      // Format specific data types
      if (col.key.includes('date') && value) {
        value = new Date(value).toLocaleDateString()
      } else if (col.key.includes('cost') || col.key.includes('value')) {
        value = value ? parseFloat(value).toFixed(2) : ''
      } else if (col.key.includes('percentage') && value) {
        value = parseFloat(value).toFixed(1) + '%'
      }
      
      return escapeCSVField(value)
    }).join(',')
  )
  
  return [header, ...rows].join('\n')
}

// PDF generation placeholder - would need a more complete PDF library
function generatePDF(data: any[], reportType: string, summary?: any): Uint8Array {
  // For now, return a simple text-based PDF placeholder
  // In production, you'd use a library like jsPDF or puppeteer
  const content = `
    BrewCrush Report - ${reportType.toUpperCase()}
    Generated: ${new Date().toLocaleString()}
    
    ${summary ? `Summary: ${JSON.stringify(summary, null, 2)}` : ''}
    
    Data Records: ${data.length}
    
    Note: Full PDF generation is not implemented in this demo.
    Please use CSV export for detailed data.
  `
  
  // Convert to Uint8Array (simplified - real PDF would be more complex)
  return new TextEncoder().encode(content)
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    })

    // Parse request
    const url = new URL(req.url)
    const reportType = url.searchParams.get('type')
    const format = url.searchParams.get('format') || 'json'
    
    if (!reportType) {
      throw new Error('Report type is required')
    }

    let reportData: any
    let filename: string
    let summary: any

    // Generate the appropriate report based on type
    switch (reportType) {
      case 'inventory': {
        const body = await req.json().catch(() => ({}))
        const { data, error } = await supabase.rpc('generate_inventory_report', {
          p_filters: body.filters || {},
          p_sort: body.sort || {},
          p_format: format
        })
        
        if (error) throw error
        reportData = data.data
        filename = data.filename || `inventory_report_${Date.now()}.${format}`
        summary = data.summary
        break
      }

      case 'batch_summary': {
        const body = await req.json().catch(() => ({}))
        const { data, error } = await supabase.rpc('generate_batch_summary_report', {
          p_filters: body.filters || {},
          p_sort: body.sort || {},
          p_format: format
        })
        
        if (error) throw error
        reportData = data.data
        filename = data.filename || `batch_summary_${Date.now()}.${format}`
        summary = data.summary
        break
      }

      case 'po_aging': {
        const body = await req.json().catch(() => ({}))
        const { data, error } = await supabase.rpc('generate_po_aging_report', {
          p_filters: body.filters || {},
          p_sort: body.sort || {},
          p_format: format
        })
        
        if (error) throw error
        reportData = data.data
        filename = data.filename || `po_aging_${Date.now()}.${format}`
        summary = data.summary
        break
      }

      case 'recall_drill': {
        const body = await req.json()
        const { entity_type, entity_id, direction = 'both' } = body
        
        if (!entity_type || !entity_id) {
          throw new Error('Entity type and ID are required for recall drill')
        }

        const { data, error } = await supabase.rpc('generate_recall_drill_report', {
          p_entity_type: entity_type,
          p_entity_id: entity_id,
          p_direction: direction,
          p_format: format
        })
        
        if (error) throw error
        reportData = data.trace_data || data.data
        filename = data.filename || `recall_drill_${Date.now()}.${format}`
        summary = data.impact_summary
        break
      }

      default:
        throw new Error(`Unsupported report type: ${reportType}`)
    }

    // Generate response based on format
    if (format === 'csv') {
      const csvContent = generateCSV(reportData, reportType)
      
      return new Response(csvContent, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    } else if (format === 'pdf') {
      const pdfContent = generatePDF(reportData, reportType, summary)
      
      return new Response(pdfContent, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename.replace('.csv', '.pdf')}"`,
        },
      })
    } else {
      // Return JSON with metadata
      return new Response(
        JSON.stringify({
          success: true,
          reportType,
          format,
          data: reportData,
          summary,
          filename,
          generatedAt: new Date().toISOString(),
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }

  } catch (error) {
    console.error('Report generation error:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    )
  }
})