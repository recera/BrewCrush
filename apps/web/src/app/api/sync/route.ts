import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the request body
    const { actions } = await request.json();
    
    if (!Array.isArray(actions) || actions.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    // Add user context to each action
    const enrichedActions = actions.map(action => ({
      ...action,
      userId: user.id,
      timestamp: action.timestamp || Date.now(),
    }));

    // Call the Edge Function
    const { data, error } = await supabase.functions.invoke('sync', {
      body: { actions: enrichedActions },
    });

    if (error) {
      console.error('Sync edge function error:', error);
      
      // Check for specific error types
      if (error.message?.includes('conflict')) {
        return NextResponse.json(
          { 
            error: 'Conflict detected',
            conflictType: 'data_conflict',
            details: error.message,
            actions: enrichedActions 
          },
          { status: 409 }
        );
      }
      
      if (error.message?.includes('insufficient')) {
        return NextResponse.json(
          { 
            error: 'Insufficient resources',
            conflictType: 'resource_constraint',
            details: error.message,
            actions: enrichedActions 
          },
          { status: 409 }
        );
      }
      
      return NextResponse.json(
        { error: error.message || 'Sync failed' },
        { status: 500 }
      );
    }

    // Process results and handle partial failures
    const results = data?.results || [];
    const failures = results.filter((r: any) => r.status === 'error');
    
    if (failures.length > 0) {
      // Some actions failed
      return NextResponse.json(
        {
          success: false,
          results,
          failures,
          message: `${failures.length} of ${actions.length} actions failed`
        },
        { status: 207 } // Multi-status
      );
    }

    // All actions succeeded
    return NextResponse.json({
      success: true,
      results,
      message: `Successfully synced ${actions.length} actions`
    });

  } catch (error) {
    console.error('Sync API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'sync-api'
  });
}