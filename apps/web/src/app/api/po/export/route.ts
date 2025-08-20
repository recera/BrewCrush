import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') || 'csv'
    const status = searchParams.get('status') || 'all'
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')

    // Build query
    let query = supabase
      .from('purchase_orders')
      .select(`
        id,
        po_number,
        status,
        order_date,
        due_date,
        terms,
        notes,
        created_at,
        vendors!inner(
          name,
          email,
          phone
        ),
        po_lines!inner(
          line_number,
          qty,
          uom,
          expected_unit_cost,
          notes,
          items!inner(
            name,
            sku
          )
        )
      `)
      .order('created_at', { ascending: false })

    // Apply filters
    if (status !== 'all') {
      query = query.eq('status', status)
    }
    
    if (startDate) {
      query = query.gte('order_date', startDate)
    }
    
    if (endDate) {
      query = query.lte('order_date', endDate)
    }

    const { data: purchaseOrders, error } = await query

    if (error) {
      console.error('Error fetching purchase orders:', error)
      return new NextResponse('Failed to fetch purchase orders', { status: 500 })
    }

    if (format === 'csv') {
      // Generate CSV content
      const csv = generateCSV(purchaseOrders)
      
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="purchase_orders_${new Date().toISOString().split('T')[0]}.csv"`,
        },
      })
    } else if (format === 'json') {
      return NextResponse.json(purchaseOrders)
    } else {
      return new NextResponse('Invalid format', { status: 400 })
    }
  } catch (error) {
    console.error('Export error:', error)
    return new NextResponse('Internal server error', { status: 500 })
  }
}

function generateCSV(purchaseOrders: any[]): string {
  if (!purchaseOrders || purchaseOrders.length === 0) {
    return 'No data to export'
  }

  // Flatten the data for CSV export
  const flatData: any[] = []
  
  purchaseOrders.forEach(po => {
    po.po_lines.forEach((line: any) => {
      flatData.push({
        'PO Number': po.po_number,
        'Status': po.status,
        'Order Date': po.order_date,
        'Due Date': po.due_date || '',
        'Vendor': po.vendors.name,
        'Vendor Email': po.vendors.email || '',
        'Vendor Phone': po.vendors.phone || '',
        'Terms': po.terms || '',
        'Line Number': line.line_number,
        'Item': line.items.name,
        'SKU': line.items.sku || '',
        'Quantity': line.qty,
        'UOM': line.uom,
        'Unit Cost': line.expected_unit_cost,
        'Line Total': (line.qty * line.expected_unit_cost).toFixed(2),
        'Line Notes': line.notes || '',
        'PO Notes': po.notes || '',
      })
    })
  })

  // Generate CSV headers
  const headers = Object.keys(flatData[0]).join(',')
  
  // Generate CSV rows
  const rows = flatData.map(row => {
    return Object.values(row).map(value => {
      // Escape values that contain commas or quotes
      if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
        return `"${value.replace(/"/g, '""')}"`
      }
      return value
    }).join(',')
  })

  return [headers, ...rows].join('\n')
}