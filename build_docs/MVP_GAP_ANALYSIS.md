# BrewCrush MVP Gap Analysis Report

**Version:** 1.0  
**Date:** 2025-08-21  
**Author:** Gemini Senior Software Engineer

## 1. Executive Summary

This report provides an in-depth analysis of the BrewCrush codebase against the v1.1 Product Requirements Document (PRD) to identify critical gaps for the Minimum Viable Product (MVP) launch.

The initial analysis provided was directionally correct in identifying weaknesses within the **Production module** but presented an incomplete picture of the project's overall maturity. A thorough review of the database schema, frontend components, API routes, and tests reveals that **the project is substantially closer to MVP than previously assessed.**

Major functional areas such as **Billing, Compliance, Reporting, and Purchasing are largely complete** and well-supported by a robust backend infrastructure, including a comprehensive set of database tables, functions, and materialized views.

The most significant remaining gaps are not in backend functionality but in the **frontend user experience (UX) and the seamless integration of the core production workflow.** The production features, while mostly present, are fragmented across the UI, lack key interactive elements, and do not fully expose the powerful backend capabilities.

**Conclusion:** The project is on a strong footing for an MVP launch. The immediate focus should be on refining the Information Architecture and polishing the core Production module's UI to match the completeness of the backend.

---

## 2. Detailed Analysis by PRD Capability

This analysis evaluates the current implementation status against the "Must-Have" features defined in the PRD.

### 2.1. Billing & Onboarding (PRD §14)

**Status: ✅ Largely Complete**

The billing system is well-developed and appears to meet all MVP requirements.

- **Evidence:**
  - **Database:** Migrations `00022` through `00025` establish a comprehensive billing schema, including `billing_plans`, `account_billing`, `observed_production_snapshots`, and `invoices`.
  - **Backend Logic:** The `calculate-observed-production` Edge Function and `check_plan_suggestions` RPC are implemented.
  - **Frontend:** The signup flow (`apps/web/src/app/auth/signup/page.tsx`) correctly implements BBL attestation. A dedicated billing settings page (`apps/web/src/app/settings/billing/page.tsx`) exists for plan management.
  - **Testing:** A dedicated test suite (`apps/web/__tests__/billing/`) validates OP calculation, read-only mode enforcement, the signup flow, and Stripe webhooks, indicating high confidence in this module's reliability.

- **Gaps:**
  - **Minor:** The UI for optional setup packages (PRD §14.8) is present on the billing page but the checkout flow (`/api/stripe/checkout/route.ts`) needs to be fully validated end-to-end.

### 2.2. Compliance (PRD §6.7)

**Status: ✅ Largely Complete**

The compliance engine is robust, with backend support for all specified TTB reports.

- **Evidence:**
  - **Database:** Migrations `00016` and `00017` create the necessary tables (`ttb_periods`, `excise_worksheets`, `inbond_transfers`, `removals`) and RPCs for generating compliance data.
  - **Frontend:** A `ComplianceCenter` component exists, with sub-components for BROP, Excise, Transfers, and Sales Ingest, matching the PRD spec.
  - **Backend Logic:** Edge functions like `generate-brop-pdf` and `generate-transfer-pdf` are implemented, showing that document generation is a core capability.
  - **Sales Ingest:** The `sales-ingest-api` and `sales-ingest-csv` functions, along with the `SalesIngest.tsx` component, fulfill the requirement for posting removals.

- **Gaps:**
  - **Minor:** The UI for "Data Check" and "Anomalies List" (PRD §6.7) within the Compliance Center needs to be fully implemented and connected to backend validation logic.

### 2.3. Reporting & Dashboards (PRD §6.8)

**Status: ✅ Largely Complete**

The reporting infrastructure is extensive, leveraging performant materialized views. The dashboard is role-aware as specified.

- **Evidence:**
  - **Database:** Migration `00018` creates multiple materialized views (`mv_inventory_on_hand`, `mv_batch_summary`, `mv_po_aging`, etc.) to power fast, complex reports.
  - **Frontend:** The `reports/page.tsx` acts as a hub, loading various report components (`inventory-report.tsx`, `batch-summary-report.tsx`, etc.).
  - **Dashboards:** The `role-aware-dashboard.tsx` component and `get_dashboard_stats` RPC confirm that role-specific views are implemented as per PRD §6.8.
  - **Recall Drill:** The `comprehensive_trace` RPC (migration `00019`) and `recall-drill-report.tsx` component directly address this critical requirement.

- **Gaps:**
  - None identified for MVP. The foundation is strong enough to build any further required reports.

### 2.4. Purchasing & Inventory (PRD §6.2, §6.3)

**Status: ✅ Complete**

The purchasing and inventory modules are fully implemented and well-tested.

- **Evidence:**
  - **Database:** Migrations `00002` and `00007` establish a complete schema for items, lots, locations, POs, and receipts.
  - **Frontend:** The UI at `/purchasing` and `/inventory` is supported by a full suite of components (`POList`, `CreatePODialog`, `ReceivePODialog`, `InventoryCatalog`, `AdjustInventoryDialog`).
  - **Backend Logic:** RPCs for the entire PO lifecycle (`create_purchase_order`, `approve_purchase_order`, `receive_purchase_order`) are implemented and tested.
  - **Keg Deposit Ledger:** This feature, promoted to MVP, is implemented as per `KegDepositLedger.tsx` and its corresponding report.

- **Gaps:**
  - None identified. This module appears to be production-ready.

### 2.5. Production Workflow (PRD §6.1, §6.4, §6.5)

**Status: 🟡 Partially Complete with UX/Integration Gaps**

This is the area with the most significant gaps between backend capability and frontend implementation. The initial AI report correctly identified most of these issues.

- **Information Architecture:**
  - **Gap:** Production features are fragmented. The routes `/batches`, `/tanks`, and `/yeast` exist as top-level pages instead of being unified under `/production` as specified in PRD §7. This creates a disjointed user experience.
  - **Action:** Consolidate these pages under the `/app/production/` directory. Create a unified `/production` dashboard/landing page.

- **Recipe -> Batch Flow:**
  - **Gap:** The "Use for Batch" flow is incomplete. While `UseForBatchDialog.tsx` exists, it lacks the required logic for recipe scaling by target volume and ingredient/cost rollup to the new batch. The backend is missing a dedicated RPC for recipe scaling.
  - **Action:** Implement scaling logic within the `UseForBatchDialog` or create a backend RPC. Ensure the new batch is pre-filled with scaled ingredients and cost estimates.

- **Batch Lifecycle Management:**
  - **Gap:** There is no unified batch detail page, only the "Brew Day" view. The `BatchDetailDialog.tsx` component exists but is not a full-page view and needs to be enhanced to display the complete batch lifecycle, including COGS, inventory consumption, and QA results.
  - **Action:** Create a dedicated `/production/batches/[id]` page that provides a comprehensive overview of a batch's lifecycle, integrating data from fermentation, packaging, and costing.

- **Tank & Fermentation UI:**
  - **Gap:** The production calendar (`/production/calendar/page.tsx`) is a basic view and lacks the required drag-and-drop scheduling functionality. Fermentation charts exist in `TankDetailDialog.tsx` but do not overlay QA spec ranges (e.g., target vs. actual OG/FG) as required by PRD §6.1. Automated prompts ("Crash today?") are not implemented.
  - **Action:** Enhance the calendar component with a library like `dnd-kit`. Augment the `recharts` implementation to include QA spec overlays. Add logic to the tank board to display contextual action prompts.

- **Yeast Integration:**
  - **Gap:** The backend and UI for yeast management are present (`yeast` table, `YeastPage.tsx`). However, the integration into the batch workflow is weak. There are no clear prompts on the tank board or in the brew day UI to harvest yeast based on the schedule.
  - **Action:** Add UI elements to the tank board and batch views to prompt for yeast harvesting and link the `YeastBatch` to the `Batch` record seamlessly.

### 2.6. Offline & Mobile (PRD §8)

**Status: ✅ Core Implemented**

The core PWA and offline sync architecture is robust and well-implemented.

- **Evidence:**
  - **PWA:** `next.config.js` is configured with `next-pwa`, and a `sw.js` service worker is present.
  - **Offline Sync:** The `lib/offline/db.ts` (using `idb`) and `lib/offline/sync.ts` provide a solid foundation for an outbox pattern. The `OutboxTray.tsx` component provides necessary user feedback.
  - **Brew Day:** The `BrewDayPage` correctly uses the `useOfflineQueue` hook, making it offline-capable as required.

- **Gaps:**
  - **Uncertain Scope:** The PRD requires a "Quick Log" for fermentation readings with offline support. This component does not appear to exist. It's unclear if other critical brewhouse tasks beyond the main brew day checklist are offline-enabled.
  - **Action:** Create the `QuickLogFermReadingDialog` component and ensure it uses the offline queue. Audit other critical mobile-first actions and add offline support where necessary.

---

## 3. Final MVP Readiness Assessment

**Overall, the project is in a strong position for MVP launch.** The backend is mature, and the most complex business logic (Billing, Compliance, Reporting) is largely complete.

The critical path to launch involves closing the UX and integration gaps in the **Production module**.

**Priority MVP Gap-Closing Tasks:**

1.  **Unify Information Architecture:** Reorganize `/batches`, `/tanks`, `/yeast`, and `/recipes` under a single `/production` navigation item.
2.  **Complete Recipe-to-Batch Flow:** Implement recipe scaling and ingredient pre-filling when creating a batch from a recipe.
3.  **Enhance Batch View:** Create a comprehensive, single-page view for a batch's entire lifecycle, not just the brew day.
4.  **Improve Production Calendar:** Add drag-and-drop scheduling to the calendar view.
5.  **Implement "Quick Log":** Create the offline-capable "Quick Log" component for fermentation readings to improve the mobile experience.
