import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { corsHeaders } from '../_shared/cors.ts'

interface SyncAction {
  id: string
  op_name: string
  payload: any
  idempotency_key: string
  created_at: string
  auth_claims_hash?: string
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client with the user's JWT
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    )

    // Get the request body
    const { actions }: { actions: SyncAction[] } = await req.json()

    if (!actions || !Array.isArray(actions)) {
      return new Response(
        JSON.stringify({ error: 'Invalid request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Process each action
    const results = []
    for (const action of actions) {
      try {
        // Check if action already exists (idempotency)
        const { data: existing } = await supabaseClient
          .from('audit_logs')
          .select('id')
          .eq('idempotency_key', action.idempotency_key)
          .single()

        if (existing) {
          results.push({
            id: action.id,
            status: 'duplicate',
            message: 'Action already processed',
          })
          continue
        }

        // Process the action based on op_name
        let result
        switch (action.op_name) {
          case 'ferm_reading.create':
            result = await processFermReading(supabaseClient, action.payload)
            break
          case 'batch.consume_lot':
            result = await processBatchConsumeLot(supabaseClient, action.payload)
            break
          case 'inventory.adjust':
            result = await processInventoryAdjust(supabaseClient, action.payload)
            break
          default:
            throw new Error(`Unknown operation: ${action.op_name}`)
        }

        // Log the action to audit_logs
        await supabaseClient.from('audit_logs').insert({
          entity_table: action.op_name.split('.')[0],
          action: 'command',
          after: action.payload,
          idempotency_key: action.idempotency_key,
          curr_hash: await generateHash(action),
        })

        results.push({
          id: action.id,
          status: 'success',
          data: result,
        })
      } catch (error) {
        results.push({
          id: action.id,
          status: 'error',
          error: error.message,
        })
      }
    }

    return new Response(
      JSON.stringify({ results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function processFermReading(client: any, payload: any) {
  const { data, error } = await client
    .from('ferm_readings')
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data
}

async function processBatchConsumeLot(client: any, payload: any) {
  // This would handle consuming inventory for a batch
  // Implementation depends on your business logic
  const { data, error } = await client
    .from('inventory_transactions')
    .insert({
      ...payload,
      type: 'consume',
    })
    .select()
    .single()

  if (error) throw error
  return data
}

async function processInventoryAdjust(client: any, payload: any) {
  const { data, error } = await client
    .from('inventory_transactions')
    .insert({
      ...payload,
      type: 'adjust',
    })
    .select()
    .single()

  if (error) throw error
  return data
}

async function generateHash(action: SyncAction): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(JSON.stringify(action))
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}