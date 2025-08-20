# Phase 3 - Purchasing & Receiving: Comprehensive Audit & Completion Plan

## Current Status: 85% Complete
**Date:** August 17, 2025

## 1. PRD Requirements vs Implementation Status

### ✅ COMPLETED Features

#### Database Layer
- [x] **Tables Created:**
  - `vendors` - Complete with all fields
  - `purchase_orders` - Complete with status enum, terms, notes
  - `po_lines` - Complete with line numbers, expected costs
  - `po_receipts` - Complete structure
  - `po_receipt_lines` - Complete with lot tracking
  - `supplier_price_history` - Tracking implemented

- [x] **Core RPCs Implemented:**
  - `create_purchase_order()` - Creates PO with lines
  - `approve_purchase_order()` - Role-gated approval
  - `receive_purchase_order()` - Handles partial receipts
  - `generate_po_number()` - Sequential numbering
  - `get_low_stock_reorder_suggestions()` - Reorder point logic
  - `create_po_from_reorder_suggestions()` - Auto-create from low stock
  - `get_po_variance_analysis()` - Cost variance detection

- [x] **Triggers & Automation:**
  - `process_po_receipt()` - Creates lots and inventory transactions
  - `update_po_status_on_receipt()` - Status progression logic
  - Supplier price history auto-update on receipt

#### UI Components
- [x] **POList.tsx** - Main list view with status filtering
- [x] **CreatePODialog.tsx** - Multi-line PO creation
- [x] **ReceivePODialog.tsx** - Receiving with variance detection
- [x] **PODetailDialog.tsx** - Read-only detail view
- [x] **LowStockReorder.tsx** - Reorder suggestions with auto-PO

### ❌ MISSING/INCOMPLETE Features

#### 1. Database Completeness Issues
- [ ] **Missing Indexes for Performance:**
  ```sql
  -- Need composite indexes for common queries
  CREATE INDEX idx_po_lines_po_item ON po_lines(po_id, item_id);
  CREATE INDEX idx_po_receipts_status_date ON purchase_orders(status, due_date);
  CREATE INDEX idx_supplier_price_history_item_date ON supplier_price_history(item_id, receipt_date DESC);
  ```

- [ ] **Missing Check Constraints:**
  ```sql
  -- Quantity and cost validations
  ALTER TABLE po_lines ADD CONSTRAINT check_positive_qty CHECK (qty > 0);
  ALTER TABLE po_lines ADD CONSTRAINT check_positive_cost CHECK (expected_unit_cost >= 0);
  ALTER TABLE po_receipt_lines ADD CONSTRAINT check_qty_received CHECK (qty_received > 0);
  ```

- [ ] **Missing Status Transition Validation:**
  ```sql
  -- Need function to enforce valid status transitions
  CREATE FUNCTION validate_po_status_transition()
  ```

#### 2. RLS Policy Gaps
- [ ] **Missing RLS on new tables:**
  ```sql
  -- No policies on po_receipts, po_receipt_lines
  -- Need vendor access control policies
  -- Need cost visibility policies for brewer role
  ```

#### 3. UI/UX Gaps
- [ ] **No Edit PO functionality** - Can only create, not modify
- [ ] **No PO cancellation flow** - Missing status transition to 'cancelled'
- [ ] **No PO duplication feature** - Common user request
- [ ] **Missing PO PDF generation** - For vendor communication
- [ ] **No vendor catalog integration** - Manual item selection only
- [ ] **Missing bulk receiving** - One PO at a time
- [ ] **No receiving history view** - Can't see past receipts easily

#### 4. Validation & Error Handling
- [ ] **Insufficient over-receipt handling** - Need override reason tracking
- [ ] **No duplicate PO number prevention** - Unique constraint missing
- [ ] **Missing vendor credit limit checks** - No spending controls
- [ ] **No PO authorization limits** - Anyone can approve any amount

#### 5. Integration Gaps
- [ ] **CSV Import/Export not implemented** - PRD requirement
- [ ] **No vendor catalog import** - Manual entry only
- [ ] **Missing webhook events** - `po_created`, `po_received` not firing
- [ ] **No email notifications** - PO approval, due dates

#### 6. Testing Gaps
- [ ] **No integration tests for PO lifecycle**
- [ ] **Missing E2E tests for receiving flow**
- [ ] **No performance tests for large POs**
- [ ] **Accessibility not tested** - Scanner fallback, keyboard nav

#### 7. Reporting & Analytics
- [ ] **PO aging report not implemented**
- [ ] **Supplier performance metrics missing**
- [ ] **Spend analysis by category absent**
- [ ] **No variance trend analysis**

## 2. Critical Bugs to Fix

### 🐛 Bug #1: Race Condition in Partial Receipts
**Issue:** Multiple users receiving same PO simultaneously can over-receive
**Fix:** Add row-level locking in receive_purchase_order()

### 🐛 Bug #2: Price History Not Respecting UOM
**Issue:** Supplier price history doesn't normalize for unit conversions
**Fix:** Add UOM conversion logic to price tracking

### 🐛 Bug #3: Reorder Suggestions Ignoring In-Transit
**Issue:** Open POs not considered in reorder calculations
**Fix:** Include pending receipts in availability calculation

### 🐛 Bug #4: Status Not Rolling Back on Receipt Deletion
**Issue:** If receipt is deleted, PO status remains 'received'
**Fix:** Add trigger to recalculate status on receipt changes

## 3. Performance Optimizations Needed

### 🚀 Database Performance
1. **Add missing indexes** (listed above)
2. **Materialize expensive views:**
   ```sql
   CREATE MATERIALIZED VIEW po_summary_by_vendor AS
   SELECT vendor_id, COUNT(*), SUM(total_amount), AVG(variance_pct)
   FROM purchase_orders GROUP BY vendor_id;
   ```
3. **Partition large tables** (po_receipt_lines by month)

### 🚀 UI Performance
1. **Implement virtual scrolling** for PO lines (large POs)
2. **Add pagination** to PO list (currently loads all)
3. **Lazy load** vendor and item dropdowns
4. **Cache** vendor catalog data

## 4. Security & Compliance

### 🔒 Security Gaps
- [ ] **No audit trail for PO modifications**
- [ ] **Missing encryption for sensitive vendor data**
- [ ] **No rate limiting on PO creation**
- [ ] **SQL injection possible in search filters**

### 📋 Compliance Requirements
- [ ] **No PO approval workflow audit trail**
- [ ] **Missing segregation of duties enforcement**
- [ ] **No spend authorization matrix**
- [ ] **Purchase history retention not configured**

## 5. Implementation Priority Order

### Phase 3A: Critical Fixes (Day 1-2)
1. **Fix RLS policies** - Security first
2. **Add missing constraints** - Data integrity
3. **Fix race conditions** - Prevent data corruption
4. **Implement audit logging** - Compliance requirement

### Phase 3B: Core Functionality (Day 3-4)
1. **Edit PO functionality** - User-requested
2. **PO cancellation flow** - Business requirement
3. **CSV import/export** - PRD requirement
4. **Fix reorder suggestions** - Include in-transit

### Phase 3C: Enhanced Features (Day 5-6)
1. **PO PDF generation** - Vendor communication
2. **Bulk receiving** - Efficiency improvement
3. **Email notifications** - User awareness
4. **Vendor catalog** - Time saver

### Phase 3D: Testing & Polish (Day 7)
1. **Integration tests** - Full lifecycle
2. **E2E tests** - User flows
3. **Performance tests** - Load testing
4. **Accessibility audit** - WCAG compliance

## 6. Detailed Implementation Tasks

### Task 1: Complete RLS Policies
```sql
-- Add RLS for po_receipts
CREATE POLICY po_receipts_workspace ON po_receipts
  USING (workspace_id = get_jwt_workspace_id());

CREATE POLICY po_receipts_insert ON po_receipts
  FOR INSERT WITH CHECK (
    workspace_id = get_jwt_workspace_id() 
    AND (has_role('inventory') OR has_role('admin'))
  );

-- Add cost visibility policies
CREATE POLICY po_lines_cost_visibility ON po_lines
  FOR SELECT USING (
    workspace_id = get_jwt_workspace_id()
    AND (has_cost_visibility() OR expected_unit_cost IS NULL)
  );
```

### Task 2: Implement Edit PO
```typescript
// New EditPODialog.tsx component
interface EditPODialogProps {
  po: PurchaseOrder
  onClose: () => void
  onSuccess: () => void
}

// RPC for updating PO
CREATE FUNCTION update_purchase_order(
  p_po_id UUID,
  p_lines JSONB,
  p_notes TEXT DEFAULT NULL
) RETURNS UUID
```

### Task 3: Add PO Approval Workflow
```sql
CREATE TABLE po_approval_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  min_amount DECIMAL(10,2),
  max_amount DECIMAL(10,2),
  required_role role,
  required_approvals INT DEFAULT 1
);

CREATE TABLE po_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID REFERENCES purchase_orders(id),
  approver_id UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT
);
```

### Task 4: Implement Telemetry
```typescript
// Add to create PO flow
await trackEvent('po_created', {
  po_id: result.id,
  vendor_id: vendorId,
  total_amount: totalAmount,
  line_count: lines.length
})

// Add to receive PO flow  
await trackEvent('po_received', {
  po_id: poId,
  receipt_id: result.id,
  variance_detected: hasVariance,
  partial: isPartial
})
```

### Task 5: Create Integration Tests
```sql
-- Test file: /supabase/tests/po_lifecycle_test.sql
BEGIN;
  -- Test complete PO lifecycle
  SELECT test_create_po();
  SELECT test_approve_po();
  SELECT test_partial_receipt();
  SELECT test_complete_receipt();
  SELECT test_variance_detection();
  SELECT test_status_transitions();
  SELECT test_reorder_suggestions();
ROLLBACK;
```

### Task 6: Add CSV Import/Export
```typescript
// New /api/po/export endpoint
export async function GET(request: Request) {
  const pos = await getPurchaseOrders()
  return new Response(convertToCSV(pos), {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="purchase_orders.csv"'
    }
  })
}

// Import component
<CSVImporter
  template={PO_CSV_TEMPLATE}
  onImport={handlePOImport}
  validator={validatePOData}
/>
```

## 7. Testing Checklist

### Unit Tests
- [ ] Test all RPC functions with edge cases
- [ ] Test status transition logic
- [ ] Test variance calculation
- [ ] Test reorder suggestion algorithm
- [ ] Test price history updates

### Integration Tests  
- [ ] Full PO lifecycle (create → approve → receive → close)
- [ ] Partial receipt scenarios
- [ ] Over-receipt with override
- [ ] Concurrent receipt handling
- [ ] Status rollback on deletion

### E2E Tests
- [ ] Create PO with multiple lines
- [ ] Approve PO (role-based)
- [ ] Receive with scanner simulation
- [ ] Receive with manual entry
- [ ] Handle cost variance
- [ ] Generate reorder PO

### Performance Tests
- [ ] Load test with 1000+ POs
- [ ] Test 100-line PO creation
- [ ] Bulk receiving performance
- [ ] Report generation speed

### Accessibility Tests
- [ ] Keyboard navigation
- [ ] Screen reader compatibility
- [ ] Color contrast validation
- [ ] Touch target sizes

## 8. Documentation Needed

### User Documentation
- [ ] PO creation guide
- [ ] Receiving workflow
- [ ] Variance handling
- [ ] Reorder setup guide

### Technical Documentation  
- [ ] API endpoint documentation
- [ ] RPC function signatures
- [ ] Database schema diagram
- [ ] Integration guide

### Migration Documentation
- [ ] Upgrade path from Phase 2
- [ ] Data migration scripts
- [ ] Rollback procedures

## 9. Success Metrics

### Functional Metrics
- ✅ Can create PO with multiple lines
- ✅ Can approve based on role
- ✅ Can receive partial shipments
- ✅ Variance detection works
- ✅ Reorder suggestions accurate
- ❌ Can edit existing POs
- ❌ Can cancel POs
- ❌ CSV import/export works
- ❌ Email notifications sent

### Performance Metrics
- [ ] PO list loads < 500ms
- [ ] Create PO < 1s
- [ ] Receive PO < 2s
- [ ] Reports generate < 3s

### Quality Metrics
- [ ] 0 critical bugs
- [ ] >90% test coverage
- [ ] WCAG 2.1 AA compliant
- [ ] <1% error rate in production

## 10. Rollout Plan

### Pre-deployment
1. Complete all critical fixes
2. Run full test suite
3. Performance benchmarking
4. Security audit

### Deployment
1. Database migrations
2. Deploy Edge Functions
3. Deploy UI components
4. Enable feature flags

### Post-deployment
1. Monitor error rates
2. Check performance metrics
3. Gather user feedback
4. Plan Phase 4 integration

## Estimated Timeline

**Total Duration:** 7-8 days

- Day 1-2: Critical fixes & security
- Day 3-4: Core functionality gaps
- Day 5-6: Enhanced features
- Day 7: Testing & documentation
- Day 8: Buffer for issues

## Next Steps

1. **Immediate:** Fix RLS policies and constraints
2. **Today:** Implement edit PO functionality
3. **Tomorrow:** Add CSV import/export
4. **This Week:** Complete all Phase 3 requirements
5. **Next Week:** Begin Phase 4 (Recipes & Production)