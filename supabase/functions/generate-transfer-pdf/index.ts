import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import PDFDocument from 'https://esm.sh/pdfkit@0.13.0';
import { corsHeaders } from '../_shared/cors.ts';

interface TransferData {
  id: string;
  doc_number: string;
  shipper_entity: {
    name: string;
    ttb_permit_number: string;
    address: string;
  };
  receiver_entity: {
    name: string;
    ttb_permit_number: string;
    address: string;
  };
  same_ownership: boolean;
  shipped_at: string;
  received_at?: string;
  container_type: string;
  total_barrels: number;
  lines: Array<{
    finished_lot_id?: string;
    bulk_reference?: string;
    qty: number;
    uom: string;
    barrels: number;
  }>;
  remarks?: string;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get request data
    const { transfer_id } = await req.json();

    // Fetch transfer data with related entities
    const { data: transfer, error: transferError } = await supabase
      .from('inbond_transfers')
      .select(`
        *,
        shipper:shipper_entity_id(name, ttb_permit_number, address),
        receiver:receiver_entity_id(name, ttb_permit_number, address),
        inbond_transfer_lines(*)
      `)
      .eq('id', transfer_id)
      .single();

    if (transferError) {
      throw new Error(`Failed to fetch transfer: ${transferError.message}`);
    }

    // Create PDF document
    const doc = new PDFDocument({ 
      size: 'LETTER',
      margins: { top: 50, bottom: 50, left: 50, right: 50 }
    });

    // Collect PDF chunks
    const chunks: Uint8Array[] = [];
    doc.on('data', (chunk: Uint8Array) => chunks.push(chunk));

    // Generate PDF content
    generateTransferPDF(doc, transfer);

    // Finalize PDF
    doc.end();

    // Wait for PDF generation to complete
    await new Promise((resolve) => doc.on('end', resolve));

    // Combine chunks into single buffer
    const pdfBuffer = new Uint8Array(
      chunks.reduce((acc, chunk) => acc + chunk.length, 0)
    );
    let offset = 0;
    for (const chunk of chunks) {
      pdfBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Store PDF in Supabase Storage
    const fileName = `transfer-${transfer.doc_number}-${Date.now()}.pdf`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('docs')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        cacheControl: '3600'
      });

    if (uploadError) {
      throw new Error(`Failed to upload PDF: ${uploadError.message}`);
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('docs')
      .getPublicUrl(fileName);

    // Update transfer with document URL
    await supabase
      .from('inbond_transfers')
      .update({ docs_url: publicUrl })
      .eq('id', transfer_id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        pdf_url: publicUrl,
        file_name: fileName
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        status: 400,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});

function generateTransferPDF(doc: any, transfer: any) {
  // Header - Required marking per 27 CFR 25.186
  doc.fontSize(16).font('Helvetica-Bold')
    .text('TRANSFER WITHOUT PAYMENT OF TAX', { align: 'center' });
  doc.fontSize(10).font('Helvetica')
    .text('In accordance with 27 CFR §25.186', { align: 'center' });
  doc.moveDown();
  
  // Document Number
  doc.fontSize(12).font('Helvetica-Bold')
    .text(`Document Number: ${transfer.doc_number}`, { align: 'right' });
  doc.moveDown();

  // Shipper Information
  doc.fontSize(11).font('Helvetica-Bold')
    .text('SHIPPER INFORMATION', { underline: true });
  doc.fontSize(10).font('Helvetica');
  doc.text(`Name: ${transfer.shipper.name}`);
  doc.text(`TTB Permit: ${transfer.shipper.ttb_permit_number}`);
  doc.text(`Address: ${transfer.shipper.address}`);
  doc.moveDown();

  // Receiver Information
  doc.font('Helvetica-Bold')
    .text('RECEIVER INFORMATION', { underline: true });
  doc.font('Helvetica');
  doc.text(`Name: ${transfer.receiver.name}`);
  doc.text(`TTB Permit: ${transfer.receiver.ttb_permit_number}`);
  doc.text(`Address: ${transfer.receiver.address}`);
  doc.moveDown();

  // Transfer Details
  doc.font('Helvetica-Bold')
    .text('TRANSFER DETAILS', { underline: true });
  doc.font('Helvetica');
  doc.text(`Ship Date: ${formatDate(transfer.shipped_at)}`);
  if (transfer.received_at) {
    doc.text(`Received Date: ${formatDate(transfer.received_at)}`);
  }
  doc.text(`Ownership: ${transfer.same_ownership ? 'Same Ownership' : 'Different Ownership'}`);
  doc.text(`Container Type: ${transfer.container_type.toUpperCase()}`);
  doc.moveDown();

  // Container Details
  doc.font('Helvetica-Bold')
    .text('CONTAINER DETAILS', { underline: true });
  doc.moveDown(0.5);

  // Table headers
  const startY = doc.y;
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text('Lot/Reference', 50, startY, { width: 150 });
  doc.text('Quantity', 210, startY, { width: 80, align: 'right' });
  doc.text('UOM', 300, startY, { width: 60 });
  doc.text('Barrels', 370, startY, { width: 80, align: 'right' });
  
  // Draw line under headers
  doc.moveTo(50, startY + 15).lineTo(450, startY + 15).stroke();

  // Table rows
  doc.font('Helvetica');
  let currentY = startY + 20;
  
  transfer.inbond_transfer_lines.forEach((line: any) => {
    const reference = line.finished_lot_id || line.bulk_reference || 'Bulk';
    doc.text(reference, 50, currentY, { width: 150 });
    doc.text(line.qty.toFixed(2), 210, currentY, { width: 80, align: 'right' });
    doc.text(line.uom, 300, currentY, { width: 60 });
    doc.text(line.barrels.toFixed(2), 370, currentY, { width: 80, align: 'right' });
    currentY += 18;
  });

  // Total line
  doc.moveTo(370, currentY).lineTo(450, currentY).stroke();
  currentY += 5;
  doc.font('Helvetica-Bold');
  doc.text('TOTAL BARRELS:', 300, currentY, { width: 60 });
  doc.text(transfer.total_barrels.toFixed(2), 370, currentY, { width: 80, align: 'right' });

  doc.y = currentY + 30;
  doc.moveDown();

  // Remarks
  if (transfer.remarks) {
    doc.font('Helvetica-Bold')
      .text('REMARKS', { underline: true });
    doc.font('Helvetica')
      .text(transfer.remarks);
    doc.moveDown();
  }

  // Certification
  doc.moveDown(2);
  doc.font('Helvetica-Bold')
    .text('SHIPPER CERTIFICATION', { underline: true });
  doc.fontSize(9).font('Helvetica');
  doc.text('I certify that the above information is true and correct and that this shipment is transferred without payment of tax in accordance with applicable TTB regulations.');
  doc.moveDown();
  
  doc.text('Authorized Signature: _________________________________  Date: _______________');
  doc.moveDown(0.5);
  doc.text('Print Name: __________________________________________  Title: _______________');

  // Receiver Acknowledgment
  doc.moveDown(2);
  doc.font('Helvetica-Bold')
    .text('RECEIVER ACKNOWLEDGMENT', { underline: true });
  doc.fontSize(9).font('Helvetica');
  doc.text('I acknowledge receipt of the above-described beer in bond.');
  doc.moveDown();
  
  doc.text('Authorized Signature: _________________________________  Date: _______________');
  doc.moveDown(0.5);
  doc.text('Print Name: __________________________________________  Title: _______________');
  doc.moveDown(0.5);
  doc.text('Discrepancies (if any): _________________________________________________________');
  doc.text('_____________________________________________________________________________');

  // Footer
  doc.moveDown(2);
  doc.fontSize(8).text(
    `Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`,
    { align: 'center' }
  );
  doc.text(
    'This document must be retained for TTB inspection per 27 CFR §25.300',
    { align: 'center' }
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}