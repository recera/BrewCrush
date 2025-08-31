Bottom Line: The project needs 2-3 weeks of focused UX/integration work to reach MVP readiness,
   not a major rebuild.

  ---
  Verified Findings by Module

  1. ✅ CONFIRMED GAPS - Production Workflow

  Information Architecture (Critical)

  - Finding: Production features are fragmented across /batches, /tanks, /yeast instead of
  unified under /production
  - Evidence:
    - No /production/page.tsx exists (navigation points to non-existent route)
    - Only /production/calendar exists as a subpage
    - Shell navigation at line 43 points to /production but page is missing
  - Impact: Disjointed user experience, navigation confusion

  Recipe → Batch Flow (High Priority)

  - Finding: Recipe scaling calculation exists but ingredients aren't copied/scaled to batch
  - Evidence:
    - use_recipe_for_batch RPC calculates v_scaling_factor (lines 67-69 of migration 00010)
    - No batch_ingredients table or copying of scaled ingredients found
    - UseForBatchDialog shows scaling % but doesn't persist scaled ingredients
  - Impact: Users must manually track ingredient quantities for each batch

  Batch Lifecycle Management (High Priority)

  - Finding: No unified batch detail page exists
  - Evidence:
    - /batches/[id]/page.tsx doesn't exist
    - Only /batches/[id]/brew-day/page.tsx exists
    - BatchDetailDialog is a modal, not a full page view
  - Impact: Can't view complete batch lifecycle, COGS, QA results in one place

  Tank & Fermentation UI (Medium Priority)

  - Finding: No drag-and-drop scheduling in production calendar
  - Evidence:
    - No dnd-kit or react-dnd imports found in calendar component
    - Calendar is view-only with click interactions
    - Drag-drop only exists for file uploads (SalesIngest, POImport)
  - Impact: Less intuitive scheduling experience

  Quick Log Missing (Medium Priority)

  - Finding: No QuickLog component for fermentation readings
  - Evidence:
    - No files matching QuickLog pattern found
    - PRD requires offline-capable quick logging
  - Impact: Mobile fermentation logging less efficient

  2. ✅ MOSTLY COMPLETE - Minor Gaps

  Billing & Onboarding

  - Status: 95% Complete
  - Working:
    - BBL attestation in signup (/auth/signup/page.tsx)
    - Billing settings page with OP tracking
    - Edge function for OP calculation exists
    - Database migrations 00022-00025 implement full billing schema
  - Gap: Optional setup packages UI needs end-to-end validation

  Compliance

  - Status: 90% Complete
  - Working:
    - All components exist (BROPManager, ExciseWorksheet, TransfersInBond, etc.)
    - Backend RPCs and database schema complete
    - Edge functions for PDF generation implemented
  - Gaps:
    - Route mismatch: Shell points to /compliance but page is at /dashboard/compliance
    - Data Check and Anomalies List UI not fully visible

  Offline & Mobile

  - Status: 85% Complete
  - Working:
    - PWA configured (sw.js, workbox present)
    - Offline sync infrastructure (/lib/offline/sync.ts)
    - OutboxTray component for queue visibility
  - Gap: QuickLog component for fermentation readings missing

  3. ✅ FULLY COMPLETE

  Purchasing & Inventory

  - Status: 100% Complete
  - All components present and functional
  - Database schema, RPCs, and UI complete

  Reporting & Dashboards

  - Status: 100% Complete
  - All required reports implemented including recall drill
  - Materialized views for performance

  Yeast Management

  - Status: 95% Complete
  - Full CRUD and lifecycle tracking implemented
  - Minor gap: Harvest prompts not fully integrated into tank board UI

  ---
  Phased Launch Plan

  Phase 1: Critical UX Fixes (Week 1)

  Goal: Fix navigation and information architecture

  1. Reorganize Production Routes (2 days)
    - Create /app/production/page.tsx as unified hub
    - Move /batches, /tanks, /yeast → /production/[module]
    - Update all navigation links and imports
    - Fix compliance route (/compliance → /dashboard/compliance)
  2. Create Batch Detail Page (2 days)
    - Build /production/batches/[id]/page.tsx
    - Integrate batch lifecycle, COGS, fermentation data
    - Include QA spec comparisons
    - Link to packaging runs and yeast batches
  3. Implement Recipe Scaling (1 day)
    - Extend use_recipe_for_batch RPC to copy scaled ingredients
    - Create batch_recipe_items table
    - Update UseForBatchDialog to show ingredient preview

  Phase 2: Production Polish (Week 2)

  Goal: Complete production workflow features

  4. Add Drag-and-Drop to Calendar (2 days)
    - Install and configure @dnd-kit/sortable
    - Implement batch dragging between tanks/dates
    - Add conflict detection and CIP warnings
  5. Create QuickLog Component (1 day)
    - Build mobile-optimized fermentation logging
    - Integrate with offline queue
    - Add to tank board and batch pages
  6. Enhance Yeast Integration (1 day)
    - Add harvest prompts to tank cards
    - Create yeast availability indicator in brew day
    - Link yeast batches in batch detail view
  7. Fermentation Charts (1 day)
    - Add QA spec overlays to existing charts
    - Implement trend indicators
    - Add automated action prompts

  Phase 3: Final Polish & Testing (Week 3)

  Goal: Production readiness

  8. End-to-End Testing (2 days)
    - Test complete brew → package → BROP flow
    - Verify offline sync reliability
    - Test all user roles and permissions
  9. Performance Optimization (1 day)
    - Implement virtual scrolling for large lists
    - Optimize bundle size
    - Ensure p95 API < 400ms
  10. Documentation & Deployment (2 days)
    - Update onboarding flow
    - Create help tooltips
    - Deploy to staging for pilot testing

  ---
  Risk Assessment

  Low Risk Items

  - Billing/Compliance/Reporting: Backend complete, minimal frontend work needed
  - Database: Schema is comprehensive and well-designed
  - Authentication/Security: RLS and permissions properly implemented

  Medium Risk Items

  - Recipe Scaling: Requires new database table and RPC modifications
  - Drag-and-Drop: New library integration, potential performance concerns

  High Risk Items

  - Route Reorganization: Touches many files, risk of breaking imports
  - Offline Sync Conflicts: Edge cases in concurrent edits need testing

  ---
  Resource Requirements

  Development Team

  - 1 Senior Full-Stack Developer: Lead implementation (3 weeks)
  - 1 Frontend Developer: UI polish and testing (2 weeks)
  - 1 QA Engineer: Testing and validation (1 week, overlapping)

  External Dependencies

  - dnd-kit library: For drag-and-drop (~20KB gzipped)
  - No new backend services required

  ---
  Success Metrics

  Week 1 Completion

  - All production routes consolidated under /production
  - Batch detail page functional
  - Recipe scaling persists ingredients

  Week 2 Completion

  - Drag-and-drop scheduling works
  - QuickLog component deployed
  - Yeast prompts visible

  Week 3 Completion

  - All automated tests passing
  - Performance targets met
  - 8+ pilot breweries successfully complete test batches

  ---
  Recommendation

  Proceed with Phase 1 immediately. The project's strong foundation means these are primarily UX
  integration tasks, not architectural changes. The three-week timeline is conservative and
  allows for discovery of edge cases.

  The key insight is that BrewCrush's backend is production-ready—the gap is in surfacing these
  capabilities through polished UI/UX. This is a much better position than having UI without
  backend support.

  Focus on the Production module first as it's the daily-use workflow. Compliance and billing
  modules can ship with minor tweaks since their backend is solid.