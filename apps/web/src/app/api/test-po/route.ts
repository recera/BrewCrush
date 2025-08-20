import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * Test endpoint for verifying PO functionality
 * Run with: curl http://localhost:3000/api/test-po
 */
export async function GET() {
  const supabase = await createClient()
  const results: any[] = []
  
  try {
    // Test 1: Check if user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    results.push({ test: 'Authentication', status: 'PASS', user: user.email })

    // Test 2: Check RLS policies on purchase_orders
    const { data: poData, error: poError } = await supabase
      .from('purchase_orders')
      .select('id, po_number, status')
      .limit(1)
    
    if (poError) {
      results.push({ test: 'PO RLS Select', status: 'FAIL', error: poError.message })
    } else {
      results.push({ test: 'PO RLS Select', status: 'PASS', found: poData?.length || 0 })
    }

    // Test 3: Check RLS policies on po_receipts
    const { data: receiptData, error: receiptError } = await supabase
      .from('po_receipts')
      .select('id')
      .limit(1)
    
    if (receiptError) {
      results.push({ test: 'Receipt RLS Select', status: 'FAIL', error: receiptError.message })
    } else {
      results.push({ test: 'Receipt RLS Select', status: 'PASS', found: receiptData?.length || 0 })
    }

    // Test 4: Check if edit_purchase_order function exists
    const { error: editFnError } = await supabase.rpc('edit_purchase_order', {
      p_po_id: '00000000-0000-0000-0000-000000000000',
      p_notes: 'test'
    })
    
    // We expect an error (PO not found), but not a function not found error
    if (editFnError?.message?.includes('function') && editFnError?.message?.includes('does not exist')) {
      results.push({ test: 'Edit PO Function', status: 'FAIL', error: 'Function not found' })
    } else {
      results.push({ test: 'Edit PO Function', status: 'PASS', error: editFnError?.message || 'Function exists' })
    }

    // Test 5: Check if cancel_purchase_order function exists
    const { error: cancelFnError } = await supabase.rpc('cancel_purchase_order', {
      p_po_id: '00000000-0000-0000-0000-000000000000',
      p_reason: 'test'
    })
    
    if (cancelFnError?.message?.includes('function') && cancelFnError?.message?.includes('does not exist')) {
      results.push({ test: 'Cancel PO Function', status: 'FAIL', error: 'Function not found' })
    } else {
      results.push({ test: 'Cancel PO Function', status: 'PASS', error: cancelFnError?.message || 'Function exists' })
    }

    // Test 6: Check if reorder suggestions function exists
    const { data: reorderData, error: reorderError } = await supabase.rpc('get_low_stock_reorder_suggestions')
    
    if (reorderError?.message?.includes('function') && reorderError?.message?.includes('does not exist')) {
      results.push({ test: 'Reorder Suggestions Function', status: 'FAIL', error: 'Function not found' })
    } else {
      results.push({ test: 'Reorder Suggestions Function', status: 'PASS', items: reorderData?.length || 0 })
    }

    // Test 7: Check CSV export endpoint
    const csvResponse = await fetch('/api/po/export?format=csv', {
      headers: {
        'Cookie': `sb-access-token=${(await supabase.auth.getSession()).data.session?.access_token}`
      }
    })
    
    if (csvResponse.ok) {
      results.push({ test: 'CSV Export Endpoint', status: 'PASS' })
    } else {
      results.push({ test: 'CSV Export Endpoint', status: 'FAIL', status_code: csvResponse.status })
    }

    // Test 8: Verify vendor table has RLS
    const { data: vendorData, error: vendorError } = await supabase
      .from('vendors')
      .select('id, name')
      .limit(1)
    
    if (vendorError) {
      results.push({ test: 'Vendor RLS Select', status: 'FAIL', error: vendorError.message })
    } else {
      results.push({ test: 'Vendor RLS Select', status: 'PASS', found: vendorData?.length || 0 })
    }

    // Test 9: Check supplier price history table
    const { data: priceData, error: priceError } = await supabase
      .from('supplier_price_history')
      .select('id')
      .limit(1)
    
    if (priceError) {
      results.push({ test: 'Price History Table', status: 'FAIL', error: priceError.message })
    } else {
      results.push({ test: 'Price History Table', status: 'PASS', records: priceData?.length || 0 })
    }

    // Test 10: Verify cost redaction views exist
    const { data: viewData, error: viewError } = await supabase
      .from('v_po_lines_secure')
      .select('id, expected_unit_cost')
      .limit(1)
    
    if (viewError) {
      results.push({ test: 'Cost Redaction View', status: 'FAIL', error: viewError.message })
    } else {
      results.push({ test: 'Cost Redaction View', status: 'PASS', found: viewData?.length || 0 })
    }

    // Summary
    const passed = results.filter(r => r.status === 'PASS').length
    const failed = results.filter(r => r.status === 'FAIL').length
    
    return NextResponse.json({
      summary: {
        total: results.length,
        passed,
        failed,
        success_rate: `${Math.round((passed / results.length) * 100)}%`
      },
      results,
      timestamp: new Date().toISOString()
    })

  } catch (error: any) {
    return NextResponse.json({
      error: 'Test execution failed',
      message: error.message,
      results
    }, { status: 500 })
  }
}