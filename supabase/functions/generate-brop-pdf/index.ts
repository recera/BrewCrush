import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import PDFDocument from 'https://esm.sh/pdfkit@0.13.0';
import { corsHeaders } from '../_shared/cors.ts';

interface BROPData {
  period_id: string;
  workspace_id: string;
  period_type: 'monthly' | 'quarterly';
  period_start: string;
  period_end: string;
  entries: Array<{
    line_code: string;
    category: string;
    quantity_bbl: number;
    notes?: string;
  }>;
  reconciliation: {
    opening_bbl: number;
    produced_bbl: number;
    received_bbl: number;
    returned_bbl: number;
    removed_tax_bbl: number;
    removed_notax_bbl: number;
    consumed_bbl: number;
    destroyed_bbl: number;
    losses_bbl: number;
    closing_bbl: number;
  };
  brewery_info: {
    name: string;
    ttb_permit: string;
    address: string;
  };
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
    const { period_id } = await req.json();

    // Fetch BROP data from database
    const { data: period, error: periodError } = await supabase
      .from('ttb_periods')
      .select('*, ttb_entries(*)')
      .eq('id', period_id)
      .single();

    if (periodError) {
      throw new Error(`Failed to fetch period: ${periodError.message}`);
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
    generateBROPPDF(doc, period);

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
    const fileName = `brop-${period_id}-${Date.now()}.pdf`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('exports')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        cacheControl: '3600'
      });

    if (uploadError) {
      throw new Error(`Failed to upload PDF: ${uploadError.message}`);
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('exports')
      .getPublicUrl(fileName);

    // Create compliance snapshot
    const { error: snapshotError } = await supabase.rpc('finalize_compliance_snapshot', {
      p_type: 'brop',
      p_entity_id: period_id,
      p_pdf_url: publicUrl,
      p_csv_url: null,
      p_payload: period
    });

    if (snapshotError) {
      throw new Error(`Failed to create snapshot: ${snapshotError.message}`);
    }

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

function generateBROPPDF(doc: any, data: any) {
  const isMonthly = data.type === 'monthly';
  const formNumber = isMonthly ? '5130.9' : '5130.26';
  const formTitle = isMonthly ? 'MONTHLY' : 'QUARTERLY';

  // Header
  doc.fontSize(10).text('DEPARTMENT OF THE TREASURY', { align: 'center' });
  doc.text('ALCOHOL AND TOBACCO TAX AND TRADE BUREAU', { align: 'center' });
  doc.moveDown();
  
  doc.fontSize(14).font('Helvetica-Bold')
    .text(`TTB F ${formNumber}`, { align: 'center' });
  doc.fontSize(12)
    .text(`${formTitle} BREWER'S REPORT OF OPERATIONS`, { align: 'center' });
  doc.moveDown();

  // Period Information
  doc.fontSize(10).font('Helvetica');
  doc.text(`Reporting Period: ${formatDate(data.period_start)} to ${formatDate(data.period_end)}`);
  doc.text(`Due Date: ${formatDate(data.due_date)}`);
  doc.text(`Status: ${data.status.toUpperCase()}`);
  doc.moveDown();

  // Brewery Information (would be fetched from workspace)
  doc.font('Helvetica-Bold').text('BREWERY INFORMATION', { underline: true });
  doc.font('Helvetica');
  doc.text('Name: [Brewery Name]');
  doc.text('TTB Permit Number: [Permit Number]');
  doc.text('Address: [Brewery Address]');
  doc.moveDown();

  // BROP Line Items
  doc.font('Helvetica-Bold').text('REPORT OF OPERATIONS', { underline: true });
  doc.moveDown(0.5);

  // Create table-like structure
  const lineItems = [
    { line: '01', label: 'ON HAND FIRST OF MONTH', field: 'opening' },
    { line: '02', label: 'PRODUCED BY FERMENTATION', field: 'produced' },
    { line: '03', label: 'RECEIVED BY TRANSFER IN BOND', field: 'received_in_bond' },
    { line: '04', label: 'RETURNED TO BOND', field: 'returned_to_brewery' },
    { line: '05', label: 'TOTAL', field: null, isTotal: true },
    { line: '06', label: '', field: null, blank: true },
    { line: '07', label: 'TAXPAID REMOVALS', field: 'removed_tax_determined' },
    { line: '08', label: 'REMOVALS WITHOUT PAYMENT OF TAX', field: 'removed_without_tax' },
    { line: '09', label: 'CONSUMED ON BREWERY PREMISES', field: 'consumed_on_premises' },
    { line: '10', label: 'DESTROYED', field: 'destroyed' },
    { line: '11', label: 'LOSSES', field: 'loss' },
    { line: '12', label: 'TOTAL', field: null, isTotal: true },
    { line: '13', label: '', field: null, blank: true },
    { line: '14', label: '', field: null, blank: true },
    { line: '15', label: 'ON HAND END OF MONTH', field: 'closing' }
  ];

  // Draw lines
  doc.font('Helvetica');
  lineItems.forEach(item => {
    if (item.blank) {
      doc.moveDown(0.5);
      return;
    }

    const value = getEntryValue(data.ttb_entries, item.field);
    const y = doc.y;
    
    doc.fontSize(9);
    doc.text(item.line, 50, y, { width: 30 });
    doc.text(item.label, 90, y, { width: 300 });
    
    if (!item.blank) {
      doc.text(
        value !== null ? formatBarrels(value) : '', 
        400, 
        y, 
        { width: 100, align: 'right' }
      );
    }

    if (item.isTotal) {
      // Draw line above total
      doc.moveTo(400, y - 2).lineTo(500, y - 2).stroke();
    }
  });

  doc.moveDown(2);

  // Signature Section
  doc.font('Helvetica-Bold').text('CERTIFICATION', { underline: true });
  doc.font('Helvetica').fontSize(9);
  doc.text('Under penalties of perjury, I declare that I have examined this report, and to the best of my knowledge and belief, it is true, correct, and complete.');
  doc.moveDown();
  
  doc.text('Signature: _________________________________  Date: _______________');
  doc.moveDown(0.5);
  doc.text('Print Name: ________________________________  Title: _______________');
  doc.moveDown(0.5);
  doc.text('Email: _____________________________________  Phone: ______________');

  // Footer
  doc.fontSize(8).text(
    `Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`,
    { align: 'center' }
  );
}

function getEntryValue(entries: any[], category: string | null): number | null {
  if (!category) return null;
  const entry = entries.find(e => e.category === category);
  return entry ? entry.quantity_bbl : 0;
}

function formatBarrels(value: number): string {
  return value.toFixed(2);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    month: '2-digit',
    day: '2-digit',
    year: 'numeric'
  });
}