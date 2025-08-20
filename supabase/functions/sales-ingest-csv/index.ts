import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { parse } from 'https://esm.sh/csv-parse@5.5.3/sync';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Mapping presets for different POS systems
const MAPPING_PRESETS = {
  'square': {
    date: 'Date',
    sku: 'Item',
    quantity: 'Qty',
    unit: 'Unit',
    destination: 'Location',
    reference: 'Transaction ID',
  },
  'toast': {
    date: 'Business Date',
    sku: 'Menu Item',
    quantity: 'Quantity',
    unit: 'Unit',
    destination: 'Revenue Center',
    reference: 'Check Number',
  },
  'ekos': {
    date: 'Date',
    sku: 'Product',
    quantity: 'Quantity',
    unit: 'UOM',
    destination: 'Customer',
    reference: 'Invoice Number',
  },
  'beer30': {
    date: 'Date',
    sku: 'Beer',
    quantity: 'Amount',
    unit: 'Unit',
    destination: 'Location',
    reference: 'Reference',
  },
  'custom': {
    date: 'date',
    sku: 'sku_code',
    quantity: 'quantity',
    unit: 'unit',
    destination: 'destination_type',
    reference: 'doc_ref',
  },
};

// Convert various date formats to YYYY-MM-DD
function parseDate(dateStr: string): string {
  const cleaned = dateStr.trim();
  
  // Try different date formats
  const formats = [
    /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
    /^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY
    /^\d{2}-\d{2}-\d{4}$/, // MM-DD-YYYY
  ];
  
  if (formats[0].test(cleaned)) {
    return cleaned;
  }
  
  if (formats[1].test(cleaned) || formats[2].test(cleaned)) {
    const parts = cleaned.split(/[\/\-]/);
    const month = parts[0].padStart(2, '0');
    const day = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  
  // Try to parse with Date object as fallback
  const date = new Date(cleaned);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }
  
  throw new Error(`Invalid date format: ${dateStr}`);
}

// Convert quantity to barrels based on unit
function convertToBarrels(quantity: number, unit: string): number {
  const unitLower = unit.toLowerCase();
  
  // Conversion factors to barrels (1 barrel = 31 gallons = 117.348 liters)
  const conversions: Record<string, number> = {
    'barrel': 1,
    'barrels': 1,
    'bbl': 1,
    'keg': 0.5, // Half barrel keg
    'kegs': 0.5,
    'case': 0.0645, // 24 x 12oz = 2.25 gallons
    'cases': 0.0645,
    'sixpack': 0.0135, // 6 x 12oz = 0.42 gallons
    'sixpacks': 0.0135,
    'gallon': 0.0323,
    'gallons': 0.0323,
    'liter': 0.00852,
    'liters': 0.00852,
    'oz': 0.000252, // Fluid ounces
    'pint': 0.00403,
    'pints': 0.00403,
  };
  
  const factor = conversions[unitLower];
  if (!factor) {
    throw new Error(`Unknown unit: ${unit}`);
  }
  
  return quantity * factor;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Verify the user's JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      throw new Error('Invalid authentication');
    }

    // Get workspace from user's current context
    const { data: userWorkspace } = await supabase
      .from('user_workspace_roles')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .single();

    if (!userWorkspace) {
      throw new Error('No workspace found for user');
    }

    // Check permissions (accounting or admin)
    if (!['accounting', 'admin'].includes(userWorkspace.role)) {
      throw new Error('Insufficient permissions for sales ingest');
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const preset = formData.get('preset') as string || 'custom';
    const groupTaproom = formData.get('group_taproom') === 'true';

    if (!file) {
      throw new Error('No file provided');
    }

    // Read and parse CSV
    const csvText = await file.text();
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    // Get mapping configuration
    const mapping = MAPPING_PRESETS[preset] || MAPPING_PRESETS.custom;

    // Create ingest job
    const jobId = crypto.randomUUID();
    const { error: jobError } = await supabase
      .from('sales_ingest_jobs')
      .insert({
        id: jobId,
        workspace_id: userWorkspace.workspace_id,
        upload_id: file.name,
        status: 'processing',
        mapping: { preset, fields: mapping },
        idempotency_key: `${file.name}-${Date.now()}`,
        total_rows: records.length,
        processed_rows: 0,
        failed_rows: 0,
        created_by: user.id,
      });

    if (jobError) {
      throw new Error(`Failed to create ingest job: ${jobError.message}`);
    }

    // Process each row
    const errors: any[] = [];
    const taproomRemovals: any[] = [];
    let processedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const rowNumber = i + 1;

      try {
        // Extract fields using mapping
        const date = parseDate(record[mapping.date]);
        const skuCode = record[mapping.sku];
        const quantity = parseFloat(record[mapping.quantity]);
        const unit = record[mapping.unit];
        const destination = record[mapping.destination] || 'unknown';
        const reference = record[mapping.reference] || '';

        if (!date || !skuCode || isNaN(quantity) || !unit) {
          throw new Error('Missing required fields');
        }

        // Convert to barrels
        const barrels = convertToBarrels(quantity, unit);

        // Parse the data
        const parsedData = {
          date,
          sku_code: skuCode,
          quantity,
          unit,
          barrels,
          destination_type: destination.toLowerCase(),
          doc_ref: reference,
        };

        // Create row record
        const { data: rowData, error: rowError } = await supabase
          .from('sales_ingest_rows')
          .insert({
            job_id: jobId,
            row_number: rowNumber,
            parsed_data: parsedData,
            status: 'pending',
          })
          .select()
          .single();

        if (rowError) {
          throw new Error(`Failed to create row: ${rowError.message}`);
        }

        // Find the SKU
        const { data: sku } = await supabase
          .from('finished_skus')
          .select('id')
          .eq('workspace_id', userWorkspace.workspace_id)
          .eq('code', skuCode)
          .single();

        if (!sku) {
          throw new Error(`SKU not found: ${skuCode}`);
        }

        // Find a finished lot for this SKU (FIFO)
        const { data: lot } = await supabase
          .from('finished_lots')
          .select('id, quantity')
          .eq('workspace_id', userWorkspace.workspace_id)
          .eq('sku_id', sku.id)
          .gt('quantity', 0)
          .order('created_at', { ascending: true })
          .limit(1)
          .single();

        if (!lot) {
          throw new Error(`No inventory available for SKU: ${skuCode}`);
        }

        // Determine if taxable based on destination
        const isTaxable = !['export', 'research', 'supplies_vessels'].includes(parsedData.destination_type);

        // Group taproom removals if requested
        if (groupTaproom && parsedData.destination_type === 'taproom') {
          const existing = taproomRemovals.find(r => r.date === date && r.sku_id === sku.id);
          if (existing) {
            existing.quantity += quantity;
            existing.barrels += barrels;
          } else {
            taproomRemovals.push({
              date,
              sku_id: sku.id,
              lot_id: lot.id,
              quantity,
              unit,
              barrels,
            });
          }
        } else {
          // Create removal
          const { data: removal, error: removalError } = await supabase
            .from('removals')
            .insert({
              workspace_id: userWorkspace.workspace_id,
              finished_lot_id: lot.id,
              removal_date: date,
              qty: quantity,
              uom: unit,
              barrels: barrels,
              reason: parsedData.destination_type === 'taproom' ? 'consumption' : 'sale',
              is_taxable: isTaxable,
              doc_ref: reference,
              destination_type: parsedData.destination_type,
              created_by: user.id,
            })
            .select()
            .single();

          if (removalError) {
            throw new Error(`Failed to create removal: ${removalError.message}`);
          }

          // Update the row with removal ID
          await supabase
            .from('sales_ingest_rows')
            .update({
              status: 'processed',
              removal_id: removal.id,
            })
            .eq('id', rowData.id);

          // Create inventory transaction
          await supabase
            .from('inventory_transactions')
            .insert({
              workspace_id: userWorkspace.workspace_id,
              type: 'ship',
              item_lot_id: lot.id,
              quantity: -quantity,
              uom: unit,
              ref_type: 'removal',
              ref_id: removal.id,
              created_by: user.id,
            });
        }

        processedCount++;

      } catch (error: any) {
        failedCount++;
        errors.push({
          row: rowNumber,
          error: error.message,
          data: record,
        });

        // Update row status
        await supabase
          .from('sales_ingest_rows')
          .update({
            status: 'failed',
            error_text: error.message,
          })
          .eq('job_id', jobId)
          .eq('row_number', rowNumber);
      }
    }

    // Process grouped taproom removals
    for (const taproomGroup of taproomRemovals) {
      const { data: removal } = await supabase
        .from('removals')
        .insert({
          workspace_id: userWorkspace.workspace_id,
          finished_lot_id: taproomGroup.lot_id,
          removal_date: taproomGroup.date,
          qty: taproomGroup.quantity,
          uom: taproomGroup.unit,
          barrels: taproomGroup.barrels,
          reason: 'consumption',
          is_taxable: true,
          doc_ref: `Taproom sales ${taproomGroup.date}`,
          destination_type: 'taproom',
          created_by: user.id,
        })
        .select()
        .single();

      if (removal) {
        // Create inventory transaction
        await supabase
          .from('inventory_transactions')
          .insert({
            workspace_id: userWorkspace.workspace_id,
            type: 'ship',
            item_lot_id: taproomGroup.lot_id,
            quantity: -taproomGroup.quantity,
            uom: taproomGroup.unit,
            ref_type: 'removal',
            ref_id: removal.id,
            created_by: user.id,
          });
      }
    }

    // Generate error CSV if needed
    let errorCsvUrl = null;
    if (errors.length > 0) {
      const errorCsv = [
        ['Row', 'Error', 'Data'],
        ...errors.map(e => [e.row, e.error, JSON.stringify(e.data)]),
      ].map(row => row.join(',')).join('\n');

      const errorFileName = `errors-${jobId}.csv`;
      const { data: uploadData } = await supabase.storage
        .from('imports')
        .upload(errorFileName, new Blob([errorCsv], { type: 'text/csv' }));

      if (uploadData) {
        const { data: { publicUrl } } = supabase.storage
          .from('imports')
          .getPublicUrl(errorFileName);
        errorCsvUrl = publicUrl;
      }
    }

    // Update job status
    const finalStatus = failedCount === 0 ? 'completed' : 
                       failedCount < records.length ? 'completed_with_errors' : 
                       'failed';

    await supabase
      .from('sales_ingest_jobs')
      .update({
        status: finalStatus,
        processed_rows: processedCount,
        failed_rows: failedCount,
        error_csv_url: errorCsvUrl,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    return new Response(
      JSON.stringify({
        success: true,
        job_id: jobId,
        total_rows: records.length,
        processed_rows: processedCount,
        failed_rows: failedCount,
        error_csv_url: errorCsvUrl,
        errors: errors.slice(0, 10), // Return first 10 errors
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error('Sales ingest error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});