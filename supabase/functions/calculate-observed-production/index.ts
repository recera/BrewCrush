import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    // Get all active workspaces
    const { data: workspaces, error: workspacesError } = await supabaseClient
      .from('workspaces')
      .select('id, name')
      .eq('deleted_at', null)

    if (workspacesError) {
      throw workspacesError
    }

    const results = []

    for (const workspace of workspaces || []) {
      try {
        // Calculate OP for this workspace
        const { data: opResult, error: opError } = await supabaseClient
          .rpc('calculate_observed_production', {
            p_workspace_id: workspace.id
          })

        if (opError) {
          console.error(`Error calculating OP for workspace ${workspace.id}:`, opError)
          results.push({
            workspace_id: workspace.id,
            status: 'error',
            error: opError.message
          })
          continue
        }

        // Store the snapshot
        const { error: snapshotError } = await supabaseClient
          .from('observed_production_snapshots')
          .upsert({
            workspace_id: workspace.id,
            date: new Date().toISOString().split('T')[0],
            op_annualized_bbl: opResult || 0,
            packaged_bbl_90d: (opResult || 0) * 90 / 365, // Reverse calculate for storage
            created_at: new Date().toISOString()
          }, {
            onConflict: 'workspace_id,date'
          })

        if (snapshotError) {
          console.error(`Error storing snapshot for workspace ${workspace.id}:`, snapshotError)
        }

        // Check for plan suggestions
        const { error: suggestionError } = await supabaseClient
          .rpc('check_plan_suggestions', {
            p_workspace_id: workspace.id
          })

        if (suggestionError) {
          console.error(`Error checking suggestions for workspace ${workspace.id}:`, suggestionError)
        }

        // Check if we need to send notification about plan suggestion
        const { data: activeSuggestion } = await supabaseClient
          .from('plan_change_suggestions')
          .select('id, created_at')
          .eq('workspace_id', workspace.id)
          .eq('status', 'suggested')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        // If suggestion was created in the last hour, send notification
        if (activeSuggestion && 
            new Date(activeSuggestion.created_at) > new Date(Date.now() - 60 * 60 * 1000)) {
          
          // Queue notification
          await supabaseClient
            .from('notification_queue')
            .insert({
              workspace_id: workspace.id,
              type: 'plan_suggestion',
              priority: 'low',
              payload: {
                suggestion_id: activeSuggestion.id,
                op_annualized: opResult
              }
            })
        }

        results.push({
          workspace_id: workspace.id,
          status: 'success',
          op_annualized: opResult,
          has_suggestion: !!activeSuggestion
        })

      } catch (error) {
        console.error(`Error processing workspace ${workspace.id}:`, error)
        results.push({
          workspace_id: workspace.id,
          status: 'error',
          error: String(error)
        })
      }
    }

    // Log telemetry
    await supabaseClient
      .from('ui_events')
      .insert({
        event_name: 'op_calculation_job_completed',
        workspace_id: null,
        metadata: {
          workspaces_processed: workspaces?.length || 0,
          successful: results.filter(r => r.status === 'success').length,
          failed: results.filter(r => r.status === 'error').length
        }
      })

    return new Response(
      JSON.stringify({
        success: true,
        workspaces_processed: workspaces?.length || 0,
        results
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error in calculate-observed-production function:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})