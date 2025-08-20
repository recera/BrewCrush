import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SalesEvent {
  date: string;
  sku_code: string;
  quantity: number;
  unit: string;
  destination_type?: string;
  doc_ref?: string;
  customer_id?: string;
}

// Convert quantity to barrels based on unit
function convertToBarrels(quantity: number, unit: string): number {
  const unitLower = unit.toLowerCase();
  
  const conversions: Record<string, number> = {
    'barrel': 1,
    'barrels': 1,
    'bbl': 1,
    'keg': 0.5,
    'kegs': 0.5,
    'case': 0.0645,
    'cases': 0.0645,
    'sixpack': 0.0135,
    'sixpacks': 0.0135,
    'gallon': 0.0323,
    'gallons': 0.0323,
    'liter': 0.00852,
    'liters': 0.00852,
    'oz': 0.000252,
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

    // Get the auth header - could be user JWT or API key
    const authHeader = req.headers.get('Authorization');
    const apiKey = req.headers.get('X-API-Key');
    
    let workspaceId: string;
    let userId: string | null = null;

    if (authHeader) {
      // User JWT auth
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

      // Check permissions
      if (!['accounting', 'admin', 'inventory'].includes(userWorkspace.role)) {
        throw new Error('Insufficient permissions for sales ingest');
      }

      workspaceId = userWorkspace.workspace_id;
      userId = user.id;

    } else if (apiKey) {
      // API key auth (for automated integrations)
      const { data: apiKeyData } = await supabase
        .from('api_keys')
        .select('workspace_id, permissions')
        .eq('key_hash', apiKey) // In production, hash the API key
        .eq('is_active', true)
        .single();

      if (!apiKeyData) {
        throw new Error('Invalid API key');
      }

      // Check if API key has sales_ingest permission
      if (!apiKeyData.permissions?.includes('sales_ingest')) {
        throw new Error('API key lacks sales_ingest permission');
      }

      workspaceId = apiKeyData.workspace_id;
    } else {
      throw new Error('No authentication provided');
    }

    // Parse request body
    const body = await req.json();
    const events: SalesEvent[] = Array.isArray(body) ? body : [body];

    if (events.length === 0) {
      throw new Error('No events provided');
    }

    if (events.length > 1000) {
      throw new Error('Maximum 1000 events per request');
    }

    // Process events
    const results = [];
    const errors = [];

    for (const event of events) {
      try {
        // Validate required fields
        if (!event.date || !event.sku_code || !event.quantity || !event.unit) {
          throw new Error('Missing required fields: date, sku_code, quantity, unit');
        }

        // Parse date
        const date = new Date(event.date);
        if (isNaN(date.getTime())) {
          throw new Error(`Invalid date: ${event.date}`);
        }

        // Convert to barrels
        const barrels = convertToBarrels(event.quantity, event.unit);

        // Create idempotency key from event data
        const idempotencyKey = `${event.doc_ref || ''}-${event.sku_code}-${event.date}`;

        // Check if this event was already processed
        const { data: existingRemoval } = await supabase
          .from('removals')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('doc_ref', event.doc_ref || '')
          .eq('removal_date', date.toISOString().split('T')[0])
          .single();

        if (existingRemoval) {
          results.push({
            status: 'duplicate',
            removal_id: existingRemoval.id,
            message: 'Event already processed',
          });
          continue;
        }

        // Find the SKU
        const { data: sku, error: skuError } = await supabase
          .from('finished_skus')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('code', event.sku_code)
          .single();

        if (skuError || !sku) {
          throw new Error(`SKU not found: ${event.sku_code}`);
        }

        // Find a finished lot for this SKU (FIFO)
        const { data: lot, error: lotError } = await supabase
          .from('finished_lots')
          .select('id, quantity')
          .eq('workspace_id', workspaceId)
          .eq('sku_id', sku.id)
          .gt('quantity', 0)
          .order('created_at', { ascending: true })
          .limit(1)
          .single();

        if (lotError || !lot) {
          throw new Error(`No inventory available for SKU: ${event.sku_code}`);
        }

        // Check if we have enough inventory
        if (lot.quantity < event.quantity) {
          throw new Error(`Insufficient inventory for SKU ${event.sku_code}: available ${lot.quantity}, requested ${event.quantity}`);
        }

        // Determine if taxable based on destination
        const destinationType = event.destination_type || 'sale';
        const isTaxable = !['export', 'research', 'supplies_vessels'].includes(destinationType);

        // Determine reason based on destination
        let reason: string;
        switch (destinationType) {
          case 'taproom':
          case 'consumption':
            reason = 'consumption';
            break;
          case 'export':
            reason = 'export';
            break;
          case 'research':
            reason = 'research';
            break;
          case 'supplies_vessels':
            reason = 'supplies_vessels';
            break;
          case 'destroyed':
            reason = 'destroyed';
            break;
          case 'return':
            reason = 'return';
            break;
          default:
            reason = 'sale';
        }

        // Create removal
        const { data: removal, error: removalError } = await supabase
          .from('removals')
          .insert({
            workspace_id: workspaceId,
            finished_lot_id: lot.id,
            removal_date: date.toISOString().split('T')[0],
            qty: event.quantity,
            uom: event.unit,
            barrels: barrels,
            reason: reason,
            is_taxable: isTaxable,
            doc_ref: event.doc_ref || '',
            destination_type: destinationType,
            customer_id: event.customer_id,
            created_by: userId,
          })
          .select()
          .single();

        if (removalError) {
          throw new Error(`Failed to create removal: ${removalError.message}`);
        }

        // Create inventory transaction
        const { error: txnError } = await supabase
          .from('inventory_transactions')
          .insert({
            workspace_id: workspaceId,
            type: 'ship',
            item_lot_id: lot.id,
            quantity: -event.quantity,
            uom: event.unit,
            ref_type: 'removal',
            ref_id: removal.id,
            created_by: userId,
          });

        if (txnError) {
          throw new Error(`Failed to create inventory transaction: ${txnError.message}`);
        }

        // Update finished lot quantity
        const { error: updateError } = await supabase
          .from('finished_lots')
          .update({
            quantity: lot.quantity - event.quantity,
            updated_at: new Date().toISOString(),
          })
          .eq('id', lot.id);

        if (updateError) {
          throw new Error(`Failed to update lot quantity: ${updateError.message}`);
        }

        results.push({
          status: 'success',
          removal_id: removal.id,
          sku_code: event.sku_code,
          quantity: event.quantity,
          barrels: barrels,
        });

      } catch (error: any) {
        errors.push({
          event: event,
          error: error.message,
        });
      }
    }

    // Return response
    const success = errors.length === 0;
    const status = success ? 200 : errors.length === events.length ? 400 : 207; // 207 = Multi-Status

    return new Response(
      JSON.stringify({
        success,
        processed: results.length,
        failed: errors.length,
        results,
        errors: errors.slice(0, 10), // Return first 10 errors
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status,
      }
    );

  } catch (error: any) {
    console.error('Sales ingest API error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});