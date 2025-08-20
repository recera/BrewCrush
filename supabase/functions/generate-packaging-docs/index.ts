import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.8';
import { PDFDocument, StandardFonts, rgb } from 'https://cdn.skypack.dev/pdf-lib@1.17.1';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface GenerateDocsRequest {
  type: 'labels' | 'manifest';
  packagingRunId: string;
  format?: 'pdf' | 'zpl'; // ZPL for thermal printers later
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get request body
    const { type, packagingRunId, format = 'pdf' } = await req.json() as GenerateDocsRequest;

    // Fetch packaging run data with all related information
    const { data: packagingRun, error: fetchError } = await supabase
      .from('packaging_runs')
      .select(`
        *,
        finished_skus!inner (
          code,
          name,
          container_type,
          container_size_ml,
          pack_size,
          barrels_per_unit
        ),
        finished_lots (
          lot_code,
          quantity,
          expiry_date
        ),
        packaging_run_sources (
          batch_id,
          volume_liters,
          percentage_of_blend,
          batches!inner (
            batch_number,
            brew_date,
            recipe_versions!inner (
              recipes!inner (
                name,
                style,
                abv,
                ibu
              )
            )
          )
        ),
        inventory_locations (
          name
        ),
        workspaces!inner (
          name,
          settings
        )
      `)
      .eq('id', packagingRunId)
      .single();

    if (fetchError) {
      throw new Error(`Failed to fetch packaging run: ${fetchError.message}`);
    }

    if (!packagingRun) {
      throw new Error('Packaging run not found');
    }

    let document: Uint8Array;
    
    if (type === 'labels') {
      document = await generateLabels(packagingRun);
    } else if (type === 'manifest') {
      document = await generateManifest(packagingRun);
    } else {
      throw new Error('Invalid document type');
    }

    // Return the PDF
    return new Response(document, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${type}-${packagingRun.finished_lots[0]?.lot_code || 'unknown'}.pdf"`,
      },
    });
  } catch (error) {
    console.error('Error generating document:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function generateLabels(packagingRun: any): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Label dimensions (4" x 6" thermal label size)
  const labelWidth = 288; // 4 inches at 72 DPI
  const labelHeight = 432; // 6 inches at 72 DPI
  
  const lot = packagingRun.finished_lots[0];
  const sku = packagingRun.finished_skus;
  const brewery = packagingRun.workspaces;
  
  // Get recipe info from first batch (or blend info)
  const firstSource = packagingRun.packaging_run_sources[0];
  const recipe = firstSource?.batches?.recipe_versions?.recipes;
  const isBlend = packagingRun.packaging_run_sources.length > 1;

  // Generate a label for each unit (or batch of labels)
  const labelsPerPage = 1; // One label per page for now
  const totalLabels = Math.min(lot.quantity, 100); // Limit to 100 labels for performance

  for (let i = 0; i < totalLabels; i++) {
    const page = pdfDoc.addPage([labelWidth, labelHeight]);

    // Brewery name at top
    page.drawText(brewery.name, {
      x: labelWidth / 2 - (brewery.name.length * 6), // Rough centering
      y: labelHeight - 40,
      size: 20,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });

    // Product name
    page.drawText(sku.name, {
      x: 20,
      y: labelHeight - 80,
      size: 16,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });

    // Style and ABV
    if (recipe) {
      page.drawText(`${recipe.style} • ${recipe.abv}% ABV`, {
        x: 20,
        y: labelHeight - 105,
        size: 12,
        font: helveticaFont,
        color: rgb(0.3, 0.3, 0.3),
      });

      if (recipe.ibu) {
        page.drawText(`IBU: ${recipe.ibu}`, {
          x: 20,
          y: labelHeight - 125,
          size: 12,
          font: helveticaFont,
          color: rgb(0.3, 0.3, 0.3),
        });
      }
    }

    // Blend indicator
    if (isBlend) {
      page.drawText('BLEND', {
        x: labelWidth - 70,
        y: labelHeight - 105,
        size: 10,
        font: helveticaBold,
        color: rgb(0.5, 0, 0),
      });
    }

    // Container info
    page.drawText(`${sku.container_size_ml}ml`, {
      x: 20,
      y: labelHeight - 160,
      size: 14,
      font: helveticaFont,
      color: rgb(0, 0, 0),
    });

    // Lot code (prominently displayed)
    page.drawRectangle({
      x: 20,
      y: labelHeight - 230,
      width: labelWidth - 40,
      height: 40,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    page.drawText('LOT CODE:', {
      x: 30,
      y: labelHeight - 205,
      size: 10,
      font: helveticaFont,
      color: rgb(0.5, 0.5, 0.5),
    });

    page.drawText(lot.lot_code, {
      x: 30,
      y: labelHeight - 220,
      size: 14,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });

    // Packaging date
    const packDate = new Date(packagingRun.packaged_at);
    page.drawText(`Packaged: ${packDate.toLocaleDateString()}`, {
      x: 20,
      y: labelHeight - 260,
      size: 10,
      font: helveticaFont,
      color: rgb(0.3, 0.3, 0.3),
    });

    // Expiry date if available
    if (lot.expiry_date) {
      const expiryDate = new Date(lot.expiry_date);
      page.drawText(`Best By: ${expiryDate.toLocaleDateString()}`, {
        x: 20,
        y: labelHeight - 280,
        size: 10,
        font: helveticaFont,
        color: rgb(0.3, 0.3, 0.3),
      });
    }

    // Batch info (if single batch)
    if (!isBlend && firstSource) {
      page.drawText(`Batch: ${firstSource.batches.batch_number}`, {
        x: 20,
        y: labelHeight - 320,
        size: 9,
        font: helveticaFont,
        color: rgb(0.5, 0.5, 0.5),
      });

      const brewDate = new Date(firstSource.batches.brew_date);
      page.drawText(`Brewed: ${brewDate.toLocaleDateString()}`, {
        x: 20,
        y: labelHeight - 335,
        size: 9,
        font: helveticaFont,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    // Add a simple barcode placeholder (would need actual barcode library)
    const barcodeY = 40;
    page.drawRectangle({
      x: 20,
      y: barcodeY,
      width: labelWidth - 40,
      height: 60,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    // Barcode text (would be actual barcode in production)
    page.drawText(lot.lot_code, {
      x: labelWidth / 2 - (lot.lot_code.length * 3),
      y: barcodeY + 25,
      size: 10,
      font: helveticaFont,
      color: rgb(0, 0, 0),
    });

    // Unit number (if tracking individual units)
    page.drawText(`${i + 1} of ${lot.quantity}`, {
      x: labelWidth - 80,
      y: 20,
      size: 8,
      font: helveticaFont,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  return await pdfDoc.save();
}

async function generateManifest(packagingRun: any): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const courierFont = await pdfDoc.embedFont(StandardFonts.Courier);

  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  
  let yPosition = height - 50;
  const leftMargin = 50;
  const lineHeight = 20;

  // Header
  page.drawText('PACKAGING MANIFEST', {
    x: width / 2 - 80,
    y: yPosition,
    size: 18,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= 30;

  // Brewery info
  page.drawText(packagingRun.workspaces.name, {
    x: leftMargin,
    y: yPosition,
    size: 14,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= lineHeight;

  // Run number and date
  page.drawText(`Run #: ${packagingRun.run_number.toString().padStart(4, '0')}`, {
    x: leftMargin,
    y: yPosition,
    size: 12,
    font: helveticaFont,
    color: rgb(0, 0, 0),
  });

  const packDate = new Date(packagingRun.packaged_at);
  page.drawText(`Date: ${packDate.toLocaleString()}`, {
    x: width / 2,
    y: yPosition,
    size: 12,
    font: helveticaFont,
    color: rgb(0, 0, 0),
  });

  yPosition -= lineHeight * 2;

  // Product information
  page.drawText('PRODUCT INFORMATION', {
    x: leftMargin,
    y: yPosition,
    size: 12,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= lineHeight;

  const sku = packagingRun.finished_skus;
  page.drawText(`SKU: ${sku.code} - ${sku.name}`, {
    x: leftMargin,
    y: yPosition,
    size: 11,
    font: helveticaFont,
    color: rgb(0, 0, 0),
  });

  yPosition -= lineHeight;

  page.drawText(`Package: ${sku.container_type} - ${sku.container_size_ml}ml × ${sku.pack_size}`, {
    x: leftMargin,
    y: yPosition,
    size: 11,
    font: helveticaFont,
    color: rgb(0, 0, 0),
  });

  yPosition -= lineHeight;

  if (packagingRun.inventory_locations) {
    page.drawText(`Location: ${packagingRun.inventory_locations.name}`, {
      x: leftMargin,
      y: yPosition,
      size: 11,
      font: helveticaFont,
      color: rgb(0, 0, 0),
    });
    yPosition -= lineHeight;
  }

  yPosition -= lineHeight;

  // Lot information
  page.drawText('LOT INFORMATION', {
    x: leftMargin,
    y: yPosition,
    size: 12,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= lineHeight;

  const lot = packagingRun.finished_lots[0];
  page.drawText(`Lot Code: ${lot.lot_code}`, {
    x: leftMargin,
    y: yPosition,
    size: 11,
    font: courierFont,
    color: rgb(0, 0, 0),
  });

  yPosition -= lineHeight;

  page.drawText(`Quantity Produced: ${packagingRun.actual_quantity} units`, {
    x: leftMargin,
    y: yPosition,
    size: 11,
    font: helveticaFont,
    color: rgb(0, 0, 0),
  });

  yPosition -= lineHeight;

  if (lot.expiry_date) {
    const expiryDate = new Date(lot.expiry_date);
    page.drawText(`Expiry Date: ${expiryDate.toLocaleDateString()}`, {
      x: leftMargin,
      y: yPosition,
      size: 11,
      font: helveticaFont,
      color: rgb(0, 0, 0),
    });
    yPosition -= lineHeight;
  }

  yPosition -= lineHeight;

  // Source batches
  page.drawText('SOURCE BATCHES', {
    x: leftMargin,
    y: yPosition,
    size: 12,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= lineHeight;

  for (const source of packagingRun.packaging_run_sources) {
    const batch = source.batches;
    const recipe = batch.recipe_versions.recipes;
    
    page.drawText(`• Batch ${batch.batch_number} - ${recipe.name}`, {
      x: leftMargin + 10,
      y: yPosition,
      size: 10,
      font: helveticaFont,
      color: rgb(0, 0, 0),
    });

    page.drawText(`${source.volume_liters.toFixed(1)}L (${source.percentage_of_blend.toFixed(1)}%)`, {
      x: width - 150,
      y: yPosition,
      size: 10,
      font: helveticaFont,
      color: rgb(0, 0, 0),
    });

    yPosition -= 15;
  }

  yPosition -= lineHeight;

  // Production metrics
  page.drawText('PRODUCTION METRICS', {
    x: leftMargin,
    y: yPosition,
    size: 12,
    font: helveticaBold,
    color: rgb(0, 0, 0),
  });

  yPosition -= lineHeight;

  page.drawText(`Target Quantity: ${packagingRun.target_quantity} units`, {
    x: leftMargin,
    y: yPosition,
    size: 11,
    font: helveticaFont,
    color: rgb(0, 0, 0),
  });

  yPosition -= lineHeight;

  page.drawText(`Actual Quantity: ${packagingRun.actual_quantity} units`, {
    x: leftMargin,
    y: yPosition,
    size: 11,
    font: helveticaFont,
    color: rgb(0, 0, 0),
  });

  yPosition -= lineHeight;

  const yieldPct = ((packagingRun.actual_quantity / packagingRun.target_quantity) * 100).toFixed(1);
  page.drawText(`Yield: ${yieldPct}%`, {
    x: leftMargin,
    y: yPosition,
    size: 11,
    font: helveticaFont,
    color: rgb(0, 0, 0),
  });

  yPosition -= lineHeight;

  page.drawText(`Loss: ${packagingRun.loss_percentage.toFixed(1)}%`, {
    x: leftMargin,
    y: yPosition,
    size: 11,
    font: helveticaFont,
    color: rgb(0, 0, 0),
  });

  // Notes section if available
  if (packagingRun.notes) {
    yPosition -= lineHeight * 2;
    
    page.drawText('NOTES', {
      x: leftMargin,
      y: yPosition,
      size: 12,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });

    yPosition -= lineHeight;

    // Word wrap notes (simple implementation)
    const words = packagingRun.notes.split(' ');
    let line = '';
    const maxLineWidth = 60;

    for (const word of words) {
      if ((line + word).length > maxLineWidth) {
        page.drawText(line, {
          x: leftMargin,
          y: yPosition,
          size: 10,
          font: helveticaFont,
          color: rgb(0, 0, 0),
        });
        yPosition -= 15;
        line = word + ' ';
      } else {
        line += word + ' ';
      }
    }

    if (line) {
      page.drawText(line, {
        x: leftMargin,
        y: yPosition,
        size: 10,
        font: helveticaFont,
        color: rgb(0, 0, 0),
      });
    }
  }

  // Signature lines
  yPosition = 100;

  page.drawLine({
    start: { x: leftMargin, y: yPosition },
    end: { x: 200, y: yPosition },
    thickness: 1,
    color: rgb(0, 0, 0),
  });

  page.drawText('Packaged By', {
    x: leftMargin,
    y: yPosition - 15,
    size: 9,
    font: helveticaFont,
    color: rgb(0.5, 0.5, 0.5),
  });

  page.drawLine({
    start: { x: 250, y: yPosition },
    end: { x: 400, y: yPosition },
    thickness: 1,
    color: rgb(0, 0, 0),
  });

  page.drawText('Date', {
    x: 250,
    y: yPosition - 15,
    size: 9,
    font: helveticaFont,
    color: rgb(0.5, 0.5, 0.5),
  });

  page.drawLine({
    start: { x: 450, y: yPosition },
    end: { x: width - leftMargin, y: yPosition },
    thickness: 1,
    color: rgb(0, 0, 0),
  });

  page.drawText('QC Approved', {
    x: 450,
    y: yPosition - 15,
    size: 9,
    font: helveticaFont,
    color: rgb(0.5, 0.5, 0.5),
  });

  return await pdfDoc.save();
}