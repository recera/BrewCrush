import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

interface POData {
  id: string
  po_number: string
  status: string
  order_date: string
  due_date: string | null
  terms: string | null
  notes: string | null
  total: number
  created_at: string
  approved_at: string | null
  vendors: {
    name: string
    email: string | null
    phone: string | null
    address: string | null
  }
  po_lines: {
    line_number: number
    qty: number
    uom: string
    expected_unit_cost: number
    notes: string | null
    items: {
      name: string
      sku: string | null
    }
  }[]
  created_by: {
    full_name: string | null
    email: string
  }
  approved_by: {
    full_name: string | null
    email: string
  } | null
  workspaces: {
    name: string
    settings: any
  }
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // Fetch PO data with all related information
    const { data: poData, error } = await supabase
      .from('purchase_orders')
      .select(`
        id,
        po_number,
        status,
        order_date,
        due_date,
        terms,
        notes,
        total,
        created_at,
        approved_at,
        vendors!inner(
          name,
          email,
          phone,
          address
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
        ),
        created_by:users!purchase_orders_created_by_fkey(
          full_name,
          email
        ),
        approved_by:users!purchase_orders_approved_by_fkey(
          full_name,
          email
        ),
        workspaces!inner(
          name,
          settings
        )
      `)
      .eq('id', params.id)
      .single()

    if (error || !poData) {
      console.error('Error fetching PO:', error)
      return new NextResponse('Purchase order not found', { status: 404 })
    }

    // Generate PDF
    const pdfBytes = await generatePOPDF(poData as POData)

    // Return PDF
    return new NextResponse(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="PO_${poData.po_number}.pdf"`,
      },
    })
  } catch (error) {
    console.error('PDF generation error:', error)
    return new NextResponse('Failed to generate PDF', { status: 500 })
  }
}

async function generatePOPDF(po: POData): Promise<Uint8Array> {
  // Create a new PDF document
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([612, 792]) // Letter size
  
  // Load fonts
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  
  const { width, height } = page.getSize()
  const margin = 50
  let yPosition = height - margin

  // Helper function to draw text
  const drawText = (
    text: string,
    x: number,
    y: number,
    size: number = 10,
    font = helvetica,
    color = rgb(0, 0, 0)
  ) => {
    page.drawText(text, {
      x,
      y,
      size,
      font,
      color,
    })
  }

  // Helper function to draw a line
  const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    })
  }

  // Header - Company Name
  drawText(po.workspaces.name, margin, yPosition, 24, helveticaBold)
  yPosition -= 30

  // Add company address if available in settings
  const companyAddress = po.workspaces.settings?.address || ''
  if (companyAddress) {
    drawText(companyAddress, margin, yPosition, 10)
    yPosition -= 15
  }

  // Purchase Order Title
  yPosition -= 20
  drawText('PURCHASE ORDER', width / 2 - 80, yPosition, 18, helveticaBold)
  yPosition -= 25

  // PO Number and Date
  drawText(`PO Number: ${po.po_number}`, margin, yPosition, 12, helveticaBold)
  drawText(`Date: ${new Date(po.order_date).toLocaleDateString()}`, width - margin - 150, yPosition, 12)
  yPosition -= 20

  // Status
  drawText(`Status: ${po.status.toUpperCase()}`, margin, yPosition, 10)
  if (po.due_date) {
    drawText(`Due Date: ${new Date(po.due_date).toLocaleDateString()}`, width - margin - 150, yPosition, 10)
  }
  yPosition -= 30

  // Vendor Information Box
  drawLine(margin, yPosition, width - margin, yPosition)
  yPosition -= 20
  
  drawText('VENDOR INFORMATION', margin, yPosition, 12, helveticaBold)
  yPosition -= 20
  
  drawText(po.vendors.name, margin, yPosition, 11, helveticaBold)
  yPosition -= 15
  
  if (po.vendors.address) {
    drawText(po.vendors.address, margin, yPosition, 10)
    yPosition -= 15
  }
  
  if (po.vendors.email) {
    drawText(`Email: ${po.vendors.email}`, margin, yPosition, 10)
    yPosition -= 15
  }
  
  if (po.vendors.phone) {
    drawText(`Phone: ${po.vendors.phone}`, margin, yPosition, 10)
    yPosition -= 15
  }
  
  if (po.terms) {
    drawText(`Terms: ${po.terms}`, margin, yPosition, 10)
    yPosition -= 15
  }

  yPosition -= 10
  drawLine(margin, yPosition, width - margin, yPosition)
  yPosition -= 30

  // Line Items Header
  drawText('LINE ITEMS', margin, yPosition, 12, helveticaBold)
  yPosition -= 20

  // Table Header
  const col1 = margin
  const col2 = margin + 40
  const col3 = margin + 250
  const col4 = margin + 320
  const col5 = margin + 380
  const col6 = margin + 450

  drawText('#', col1, yPosition, 10, helveticaBold)
  drawText('Item', col2, yPosition, 10, helveticaBold)
  drawText('SKU', col3, yPosition, 10, helveticaBold)
  drawText('Qty', col4, yPosition, 10, helveticaBold)
  drawText('Unit Price', col5, yPosition, 10, helveticaBold)
  drawText('Total', col6, yPosition, 10, helveticaBold)
  yPosition -= 5
  drawLine(margin, yPosition, width - margin, yPosition)
  yPosition -= 15

  // Line Items
  let subtotal = 0
  for (const line of po.po_lines.sort((a, b) => a.line_number - b.line_number)) {
    const lineTotal = line.qty * line.expected_unit_cost
    subtotal += lineTotal

    drawText(line.line_number.toString(), col1, yPosition, 10)
    
    // Truncate item name if too long
    const itemName = line.items.name.length > 30 
      ? line.items.name.substring(0, 30) + '...' 
      : line.items.name
    drawText(itemName, col2, yPosition, 10)
    
    drawText(line.items.sku || '-', col3, yPosition, 10)
    drawText(`${line.qty} ${line.uom}`, col4, yPosition, 10)
    drawText(`$${line.expected_unit_cost.toFixed(2)}`, col5, yPosition, 10)
    drawText(`$${lineTotal.toFixed(2)}`, col6, yPosition, 10)
    
    yPosition -= 18

    // Add line notes if present
    if (line.notes) {
      drawText(`  Note: ${line.notes}`, col2, yPosition, 8, helvetica, rgb(0.5, 0.5, 0.5))
      yPosition -= 15
    }

    // Add new page if needed
    if (yPosition < 150) {
      const newPage = pdfDoc.addPage([612, 792])
      yPosition = height - margin
    }
  }

  // Total
  yPosition -= 10
  drawLine(col5 - 20, yPosition, width - margin, yPosition)
  yPosition -= 20
  
  drawText('TOTAL:', col5, yPosition, 12, helveticaBold)
  drawText(`$${(po.total || subtotal).toFixed(2)}`, col6, yPosition, 12, helveticaBold)
  yPosition -= 30

  // Notes section
  if (po.notes) {
    drawLine(margin, yPosition, width - margin, yPosition)
    yPosition -= 20
    drawText('NOTES:', margin, yPosition, 10, helveticaBold)
    yPosition -= 15
    
    // Word wrap notes
    const words = po.notes.split(' ')
    let line = ''
    const maxWidth = width - (2 * margin)
    
    for (const word of words) {
      const testLine = line + word + ' '
      const textWidth = helvetica.widthOfTextAtSize(testLine, 10)
      
      if (textWidth > maxWidth && line) {
        drawText(line.trim(), margin, yPosition, 10)
        yPosition -= 15
        line = word + ' '
      } else {
        line = testLine
      }
    }
    
    if (line) {
      drawText(line.trim(), margin, yPosition, 10)
      yPosition -= 15
    }
  }

  // Footer
  yPosition = 80
  drawLine(margin, yPosition, width - margin, yPosition)
  yPosition -= 15

  // Created by
  drawText(
    `Created by: ${po.created_by?.full_name || po.created_by?.email || 'Unknown'}`,
    margin,
    yPosition,
    8,
    helvetica,
    rgb(0.5, 0.5, 0.5)
  )
  drawText(
    `Created on: ${new Date(po.created_at).toLocaleString()}`,
    width / 2,
    yPosition,
    8,
    helvetica,
    rgb(0.5, 0.5, 0.5)
  )
  yPosition -= 12

  // Approved by (if applicable)
  if (po.approved_by && po.approved_at) {
    drawText(
      `Approved by: ${po.approved_by.full_name || po.approved_by.email}`,
      margin,
      yPosition,
      8,
      helvetica,
      rgb(0.5, 0.5, 0.5)
    )
    drawText(
      `Approved on: ${new Date(po.approved_at).toLocaleString()}`,
      width / 2,
      yPosition,
      8,
      helvetica,
      rgb(0.5, 0.5, 0.5)
    )
  }

  // Serialize the PDF and return
  return await pdfDoc.save()
}