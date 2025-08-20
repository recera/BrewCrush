# BrewCrush — Technical Build Plan & Architecture

**Stack:** Next.js (App Router) • TypeScript • Supabase (Postgres, Auth, Storage, Realtime, Edge Functions) • Stripe
**Doc status:** Comprehensive build blueprint for MVP v1.1 (US market)

---

## 0) Guiding assumptions & constraints

* **Authoritative spec:** Your PRD/UI blueprint v1.1 (Aug 2025). This plan maps one‑to‑one to the requirements, with pragmatic adaptations to a **Next.js + Supabase + Stripe** stack.
* **Tenancy:** Multi‑tenant “workspaces”; unlimited users per workspace. RLS enforces isolation.
* **Mobile‑first + offline:** PWA with an **offline outbox** for brew/ferm logs, packaging, and sales ingest.
* **No separate backend monolith.** We use:

  * **Supabase Postgres** for data, RLS, RPC (SQL functions), materialized views, and jobs.
  * **Supabase Edge Functions** (Deno) for domain workflows, long‑running tasks, PDF/CSV generation, and webhooks.
  * **Next.js** API routes **only** for UI‑adjacent concerns (auth bootstrap, file uploads orchestration) when Edge Functions aren’t ideal.
* **Job/queueing:** Postgres‑native job queue (**pg\_boss** or **graphile‑worker**) to avoid Redis.
* **Billing:** Stripe Checkout + Customer Portal; plan‑based **entitlements**; optional one‑time setup packages.

---

## 1) High‑level architecture

### 1.1 Components

* **Next.js app** (Vercel):

  * App Router + Server Components.
  * **PWA**: service worker, offline assets, IndexedDB outbox.
  * **TanStack Query** (fetch/caching) + React Hook Form + Zod.
  * **Realtime** UI via Supabase Realtime (Postgres logical replication).

* **Supabase** (managed Postgres + platform):

  * **Auth**: email/password; Google/Microsoft OAuth (near‑term) for Admins.
  * **Postgres**: normalized schema with `workspace_id` on every row; **RLS** for tenant isolation + ABAC roles.
  * **Storage**: attachments (labels, PDFs, CSV imports).
  * **Extensions**: `pgcrypto`, `pg_stat_statements`, `pg_partman` (partitioning), `pg_cron`, **pg\_boss** (jobs), `pgjwt`.
  * **Edge Functions**: immutable audit logging helpers, BROP/Excise generation, CSV ingestion, label/PDF rendering, due‑date digests, QBO CSV export.

* **Stripe**

  * Products/Prices for **Starter/Growth/Pro** and **one‑time setup packages**.
  * Checkout + Billing Portal. Webhooks → Entitlements table.

### 1.2 Deployment & environments

* **Vercel** (prod, staging, preview branches).
* **Supabase projects** per environment; migrations via **Supabase CLI** (SQL).
* **Secrets** in Vercel + Supabase Vault; rotation policy documented.
* **CI/CD**: GitHub Actions (type‑check, lint, tests, migrations, build).

### 1.3 Key data flows (sequence highlights)

**Brew day (offline‑safe):**
UI creates **outbox actions** (e.g., `ferm_reading.create`, `batch.consume_lot`) → stored in IndexedDB with idempotency keys → when online, Next.js posts to Edge Function `/sync` → Edge Function validates (Zod), begins DB txn → calls SQL RPCs → emits audit rows → returns committed records → client reconciles & clears from outbox.

**Packaging (with blends):**
UI → Edge Function `create_packaging_run` with `source_batch_ids`, allocations, date/lot template → SQL txn: verify lots/quantities, consume packaging materials, create finished lots, allocate COGS by volume, generate lot/date codes, insert ledger entries → emits **InventoryTransaction** rows → returns run summary.

**BROP/Excise:**
UI → `generate_ttb_period(period_id)` Edge Function → SQL pipelines compute reconciliation grid, materialize `ttb_entries` + `excise_worksheet` → store **snapshot** (immutable JSON + PDF) and **audit hash** → status becomes **finalized**.

### 1.4 Offline outbox pattern (client)

* **Storage:** IndexedDB (`outbox` store).
* **Envelope:** `{id, op_name, payload, created_at, idempotency_key, auth_claims_hash}`.
* **Transport:** Batched POST `/api/sync` (Next) → forwards to Edge Function with user JWT.
* **Conflict strategy:**

  * **Idempotency‑first** (server ignores duplicates via `idempotency_key` uniques).
  * **Last‑writer‑wins** on simple fields; domain ops (e.g., packaging) are transactional and reject if stale preconditions fail; client **rebase** offers a guided retry.
* **Visibility:** “Queued N actions” tray, with per‑action status and error CSV for sales ingest.

---

## 2) Data architecture (Supabase / Postgres)

> All tables have `id UUID PK`, `workspace_id`, `created_at`, `created_by`, `updated_at`, `updated_by`, and **RLS** enabled.

### 2.1 Tenancy & auth

* `workspaces` (name, plan, stripe\_customer\_id, settings JSONB)
* `users` (shadow of auth.users for denormalized lookups)
* `user_workspace_roles` (`role` enum: `admin|brewer|inventory|accounting|contract_viewer`, **unique** per (user,workspace))

**RLS (illustrative):**

```sql
-- tenant isolation
create policy tenant_isolation on any_table
  for all using (workspace_id = get_jwt_workspace_id());

-- role gates
create policy role_brewer_insert_ferm on ferm_readings
  for insert using (has_role('brewer') or has_role('admin'));
```

### 2.2 Inventory (raw, packaging, finished)

* `items` (type enum: `raw|packaging|finished|misc`, `uom`, conversions JSONB, reorder level, vendor default)
* `item_lots` (item\_id, lot\_code, qty, uom, unit\_cost, expiry, location\_id, **fifo\_index**)
* `inventory_locations` (name, type: `warehouse|tank|taproom|bond`)
* `inventory_transactions`

  * `type` enum: `receive|consume|adjust|transfer|produce|package|ship|destroy|return|in_bond`
  * qty/uom, `item_lot_id` nullable for adjustments, **ref\_type/ref\_id** (e.g., `po_receipt_line`, `packaging_run_id`)
  * **constraint**: signed direction per type
* `supplier_price_history` (item\_id, vendor\_id, receipt\_date, unit\_cost)

**Indexes:** `(workspace_id,item_id,created_at)`, `(ref_type, ref_id)`, `(item_lot_id)`.
**Partitioning:** `ferm_readings` (below) and `inventory_transactions` monthly partitions at >10M rows.

### 2.3 Purchasing (POs)

* `vendors` (name, terms, contacts)
* `purchase_orders` (status: `draft|approved|partial|received|closed`, vendor\_id, due\_date)
* `po_lines` (po\_id, item\_id, qty, uom, expected\_unit\_cost, location\_id)
* `po_receipts` (po\_id, received\_by, received\_at)
* `po_receipt_lines` (po\_receipt\_id, po\_line\_id, qty\_received, unit\_cost, lot\_code, expiry, location\_id)

  * **AFTER INSERT trigger** → create `item_lots` + `inventory_transactions(type='receive')`
* **Validation triggers:** reject **over‑receipts** unless `override_reason` set (and audit).

### 2.4 Production, tanks, fermentation & yeast

* `tanks` (name, type: `fermenter|brite|other`, capacity, cip\_status)
* `batches` (recipe\_version\_id, status, tank\_id, target\_volume, owner\_entity\_id, in\_bond bool)
* `ferm_readings` (batch\_id, sg, temp, ph, reading\_at) **partitioned by month**
* `yeast_strains` (name, source\_lab, recommended\_max\_generation)
* `yeast_batches` (strain\_id, generation, pitch\_at, harvest\_at, viability\_notes)
* `batch_yeast_links` (batch\_id, yeast\_batch\_id, role: `pitched|harvested_from`)

**Rules:**

* Harvest **increments generation** (constraint: generation ≤ recommended max → warning event).
* Tank occupancy: exclusion constraint ensures no overlapping occupancy for a tank when status indicates **occupied** (optional soft lock to allow crashes/transfer flows).

### 2.5 Packaging & finished goods

* `finished_skus` (code, size\_ml, pack\_config JSON)
* `packaging_runs` (at, sku\_id, loss\_pct, cost\_method\_used enum: `actual_lots|moving_avg`, code\_template\_id)
* `packaging_run_sources` (run\_id, batch\_id, volume\_liters)  ← **blends**
* `finished_lots` (sku\_id, lot\_code, produced\_qty, uom, run\_id)
* `lot_code_templates` (name, pattern e.g., `{YY}{JJJ}-{BATCH}-{SKU}`)

**Triggers:**

* On `packaging_runs` insert → validate materials on hand, **consume** packaging materials (FIFO or chosen lot → COGS delta recorded), allocate COGS from source batches by volume, **produce** finished lots, and insert `inventory_transactions`.

### 2.6 Compliance: BROP, Excise, In‑bond, Contract/Alt

* `ttb_periods` (type: `monthly|quarterly`, period\_start, period\_end, status: `open|draft|finalized`, due\_date)
* `ttb_entries` (period\_id, category, line\_code, quantity, source\_ref)
* `excise_worksheets` (period\_id, taxable\_removals\_total, breakdown JSON)
* `inbond_transfers` (shipper\_brewer, receiver\_brewer, same\_ownership bool, container\_type, qty/uom, docs\_url, doc\_number)
* `inbond_transfer_lines` (transfer\_id, finished\_lot\_id or bulk lot ref, qty)
* `ownership_entities` (name, ttb\_permit\_number, address)
* **Contract/alternating hooks:** `batches.owner_entity_id` and `finished_lots.owner_entity_id` for report attributions.

**Snapshotting:**
`compliance_snapshots` (period\_id, pdf\_url, csv\_url, content\_hash, created\_at). RLS: **immutable** (delete/update forbidden).

### 2.7 Sales ingest & removals

* `sales_ingest_jobs` (upload\_id, status, mapping JSON, idempotency\_key)
* `sales_ingest_rows` (job\_id, parsed JSON, status, error\_text)
* `removals` (finished\_lot\_id, qty, reason enum `sale|consumption|testing|destroyed|return`, doc\_ref, destination\_type `taproom|distributor`)

  * **AFTER INSERT** → `inventory_transactions(type='ship' or 'destroy')` + inclusion in **Excise** if taxable.

### 2.8 Audit & telemetry

* `audit_logs` (entity\_table, entity\_id, action `insert|update|delete|command`, before JSONB, after JSONB, actor\_user\_id, idempotency\_key, **prev\_hash**, curr\_hash)
  *Hash chain for tamper‑evidence.*
* `ui_events` (event\_name, role, device, workspace\_id, entity\_type, entity\_id, duration\_ms, offline\_queued bool, cost\_method, form\_type)

### 2.9 Attachments & storage

* `attachments` (entity\_table, entity\_id, storage\_path, mime\_type, size, label)
* Supabase Storage buckets: `labels`, `docs`, `imports`, `exports`.

### 2.10 Indexing & performance

* GIN on JSONB for `mapping`/`settings` fields used in filters.
* Btree on `(workspace_id, status)` for high‑traffic lists (POs, batches).
* **Materialized views** for `inventory_on_hand_by_item_location`, `inventory_value`, `supplier_price_trend`. Refresh on schedule + on relevant transactions via **NOTIFY/LISTEN** job.

---

## 3) Security, privacy & RLS model

* **RLS default deny** on all tables; specific **policies** per role & operation.
* **ABAC**: role from `user_workspace_roles`; cost visibility gate via **column‑level** policy (e.g., hide unit\_cost for `brewer` unless `brewer_plus` flag).
* **Contract Brand viewer**: policies that restrict rows by `owner_entity_id` membership and **hide** inventory costs, vendor data, and non‑owned batches/lots.
* **Audit immutability:** table only `INSERT`; no UPDATE/DELETE policies.
* **Secrets:** Stripe keys, service role keys in Vault; no keys in client bundle.
* **PII minimization:** store only required contact fields; access logged.
* **At‑rest encryption:** Supabase managed (AES‑256); app‑level encryption (option) for sensitive partner IDs if required later.

**Example RLS snippets:**

```sql
-- Cost redaction view
create view v_item_lots as
  select id, workspace_id, item_id, lot_code, qty, uom,
         case when has_cost_visibility() then unit_cost else null end as unit_cost,
         expiry, location_id
  from item_lots;
```

---

## 4) Services, APIs & domain commands

**Strategy:** CRUD over PostgREST where safe; **domain commands** via **SQL RPC functions** called from Edge Functions for invariants (packaging, BROP finalize, transfers, receiving against PO, sales ingest post).

### 4.1 Public API surface (selected)

* **Auth**

  * `/v1/auth/login` (Supabase)
  * `/v1/auth/invite` (Edge Function: create auth user + role mapping)

* **Recipes**

  * `/v1/recipes` GET/POST (PostgREST)
  * `/v1/recipes/:id/versions` POST (RPC `create_recipe_version`)
  * `/v1/recipes/:id/use` POST (RPC `use_recipe_for_batch`)

* **Inventory**

  * `/v1/items`, `/v1/items/:id/lots` GET/POST
  * `/v1/receipts` POST (RPC `receive_ad_hoc`)
  * `/v1/adjustments` POST (RPC `inventory_adjust`)
  * `/v1/transfers` POST (RPC `inventory_transfer`)

* **Purchasing**

  * `/v1/pos` GET/POST
  * `/v1/pos/:id/approve` POST (RPC)
  * `/v1/pos/:id/receive` POST (RPC `receive_po`)
  * `/v1/pos/:id` PATCH

* **Production**

  * `/v1/batches` GET/POST
  * `/v1/batches/:id` PATCH
  * `/v1/batches/:id/ferm-readings` POST
  * `/v1/batches/:id/package` POST (RPC `create_packaging_run` supports `sourceBatchIds[]`)

* **Yeast**

  * `/v1/yeast-batches` GET/POST
  * `/:id/pitch` POST (RPC) • `/:id/harvest` POST (RPC)

* **Compliance**

  * `/v1/ttb/periods` POST • `/:id` GET • `/:id/finalize` POST
  * `/v1/ttb/periods/:id/export?format=pdf|csv` GET
  * `/v1/excise/worksheets` POST • `/:id/export` GET
  * `/v1/inbond-transfers` POST • `/:id/doc` GET

* **Sales ingest**

  * `/v1/sales-ingest/csv` POST (file upload → job)
  * `/v1/sales-ingest/events` POST (single/multiple rows; idempotent)

* **Reports**

  * `/v1/reports/inventory-on-hand`, `/batch-summary`, `/production`, `/recall-drill`

**Idempotency:**
Every “posting” endpoint accepts `Idempotency-Key`. On server, we `INSERT ... ON CONFLICT (workspace_id, idempotency_key) DO NOTHING RETURNING ...`.

**Dry‑run/preview:**
RPCs accept `dry_run bool` to return diffs (e.g., **COGS delta** for lot override) without committing.

---

## 5) Frontend architecture

* **Next.js App Router**, React 18 Server Components for data‑heavy lists; Client Components for forms.
* **Data fetching:** Supabase JS on server (RSC) with **service role** only in API/Edge contexts; client uses user JWT.
* **State & forms:** TanStack Query + React Hook Form + Zod schemas shared with server (single source of truth).
* **Realtime:** Tanks board, PO lists, packaging runs subscribe via Supabase Realtime.
* **Command Palette (⌘K/CTRL‑K):** fuzzy search, quick actions.
* **Accessibility:** WCAG 2.1 AA; numeric inputs use `inputmode="decimal"`; focus traps in wizards.
* **Scanning:** ZXing (WebAssembly) for receiving and counts; fallback manual entry.
* **PWA/offline:**

  * `service-worker.js` caches shell/assets;
  * **IndexedDB outbox** module;
  * visible **offline banner & queue counter**;
  * **Background Sync** where supported.

**Route guards:** Next.js middleware checks **session** + **entitlements**; redirects to upgrade/permissions error.

---

## 6) Inventory & costing algorithms

### 6.1 Cost methods

* **COGS (default): Actual lots consumed.**
  Consumption picks FIFO lots unless explicitly overridden; deltas recorded on the Packaging/Brew Day cost preview.
* **COGS (alternate): Moving average.**
  Maintained per `item_id` (`moving_avg_cost` updated on each receipt).
* **Inventory valuation:** “Latest cost” optional for **on‑hand value** reporting.

**Implementation:**

* `calc_cost_actual(batch_id or run_id)` — sums `qty * lot.unit_cost` from linked consumptions.
* `calc_cost_moving_avg(...)` — uses current `moving_avg_cost` snapshots.
* Cost choice persisted on `packaging_runs.cost_method_used` and surfaced with a **badge** in UI & exports.

### 6.2 Blends & allocation

* On packaging with multiple `source_batch_ids`, allocate ingredient & overhead costs by **volume\_liters ratio**; persist allocation rows for audit and recall drill.

### 6.3 Keg deposit ledger

* `keg_deposit_entries` (direction `charged|returned`, amount, sku\_id, customer\_id)
* Export to QBO CSV with account mapping stored in settings.

---

## 7) Purchasing & receiving

* **Create/Approve/Receive:** role gated. Approval sets status→`approved`, locks prices.
* **Receiving against PO:** scan or select; per‑line partials create lots; cost variances flagged (line vs receipt).
* **Supplier price history:** updated from receipts; drives **cost rollups** in recipes and **price trend** report.
* **Three‑way check (Phase 1.5 with QBO):** PO ↔ Receipt ↔ BillRef (optional).

---

## 8) Yeast management & fermentation

* **Strains**: registry with max recommended generations.
* **Yeast batches**: lifecycle events `pitch`, `harvest` (increments generation).
  Harvest can **create inventory** of yeast if tracked (optional item).
* **Prompts:** `pg_cron` job computes next‑action prompts (e.g., “Harvest today?”), emitted to UI.
* **Fermentation logs:** simple numeric keypad; sparkline; offline safe.

---

## 9) Packaging, labels & lot/date codes

* **Wizard:** select batch(es), choose SKU & pack, materials check, enter yields/loss, preview **date/lot code** using template tokens `{YY}`, `{YYYY}`, `{JJJ}`, `{BATCH}`, `{SKU}`.
* **Validation:** collision check on generated codes and uniqueness per workspace.
* **Labels/Manifests:** server‑rendered PDF via Edge Function (e.g., `@react-pdf/renderer`); store in `labels/`.

---

## 10) Compliance engine (BROP + Excise + In‑bond + Contract)

* **Mapping layer:** SQL views compute BROP sections from authoritative facts: production, removals, returns, destructions, transfers, contract ownership.
* **Reconciliation rule:** `opening + production − losses − removals + returns = closing`; **policy** toggles warning vs hard stop.
* **BROP generation:**
  `generate_ttb_period(period_id)` populates `ttb_entries`, builds CSV row detail, renders PDF, writes **snapshot** & **audit**.
* **Excise worksheet:**
  `build_excise(period_id)` isolates **taxable removals**; produces worksheet JSON + CSV for Pay.gov data entry.
* **Transfers in bond:**
  Wizard posts `inbond_transfers` + inventory movement of type `in_bond`, sets `doc_number` (**sequence**), renders **printable doc**. Ownership across not‑same‑ownership is recorded for both sender and receiver **workspaces** (if both are BrewCrush customers) or stored as counterpart info otherwise.
* **Contract/Alternating proprietorship:**
  `owner_entity_id` on batches/lots drives attribution in reports and restricts visibility for **Contract Brand viewer** role.

---

## 11) Sales ingest pipeline

* **CSV ingest:**

  1. Upload CSV to `imports/` → create `sales_ingest_job` with mapping preset → Edge Function parses in stream (papaparse equivalent), validates SKU/date/qty, creates `sales_ingest_rows`.
  2. Commit phase posts `removals` in a transaction; failures recorded; downloadable **error CSV**.
  3. Option `group_taproom_by_day`: roll‑up logic in SQL.
* **API ingest:** `/v1/sales-ingest/events` accepts JSON array; idempotent per `doc_ref + sku + date`.
* **POS presets:** store field mappings per vendor (Ekos/Beer30/Ollie/Breww CSVs), selectable in UI.

---

## 12) Reporting & dashboards

* **Dashboards**: composed from materialized views + Realtime counters.

  * In fermenters/brite, packaged this week, upcoming brews, open POs, yeast status, low stock, compliance status.
* **Reports:**

  * Inventory on hand (by item/location/lot, valuation method selectable)
  * Batch summary (yield %, cost breakdown timeline)
  * Production summary (by style/SKU)
  * Packaging output
  * COGS summary
  * **Recall drill:** Graph traversal from finished lot → upstream ingredients (lots) and downstream removals/shipments.
  * PO aging, Supplier price trend (timeseries), Keg deposit ledger.
* **Exports:** all reports printable + CSV. Saved views (persisted filters in user prefs).

---

## 13) Stripe billing & entitlements

* **Stripe models:**

  * Products: Starter, Growth, Pro; prices monthly/annual (with discount).
  * Setup packages: \$299 / \$799 / \$1,499 as one‑time prices.
* **Flows:**

  * New workspace → trial (no card) → Stripe Checkout to activate plan → webhook (`checkout.session.completed`) sets `workspaces.plan` + **entitlements** row.
  * Customer Portal for self‑serve plan switches and billing details.
* **Entitlements (gate features):**

  * Starter: core MVP except features marked Growth/Pro (per PRD table).
  * Growth: + API/Webhooks, **POs**, **Sales ingest**.
  * Pro: + QBO one‑way post, SSO, priority support.
    *(If you prefer all MVP features in Starter, flip gates by config—entitlements table keeps us flexible.)*
* **Webhook security:** signed secret; retries idempotent.

**Entitlement enforcement:**

* UI hides/greys; route middleware enforces; server RPCs check `has_entitlement('pos_ingest')` etc.
* Grace periods on downgrade to avoid data lockout.

---

## 14) Observability, SRE & performance

* **Logging:** Structured logs (pino/console) from Edge Functions → Supabase logs; Frontend errors to Sentry.
* **Metrics:** request timings, DB p95/p99 (`pg_stat_statements`), queue lag, sync success rate, outbox retry counts.
* **Alerts:** on API p95 > 400ms (sustained), job failures, cron failures, snapshot errors.
* **Backups:** Supabase PITR; daily full + WAL; test restores quarterly. **RPO 15 min, RTO 4 h**.
* **Performance budgets:**

  * API p95 < 400 ms; heavy ops < 5 s.
  * TTI p95 < 2.5 s (lazy load heavy tables, virtualized rows).
  * Use **RSC** + **edge caching** for read‑heavy dashboards; revalidate tags on writes.

---

## 15) CI/CD, testing & quality

* **Repo:** pnpm workspaces: `apps/web`, `supabase`, `edge-fns`, `packages/ui`, `packages/zod-schemas`.
* **Migrations:** SQL files tracked; `supabase db push` in CI; rollback scripts alongside.
* **Tests:**

  * **Domain tests**: SQL unit tests (pgTAP) for calculations (COGS, reconciliation).
  * **Edge Functions**: Vitest + integration against ephemeral DB.
  * **E2E**: Playwright (mobile/tablet/desktop scenarios); offline mode tests (service worker).
  * **Accessibility**: Axe in CI for core screens.
* **Seed data:** sample workspace, tanks, items/lots, recipes, batches for demos and QA.
* **Quality gates:** branch protection; PR templates with test checklists per module.

---

## 16) Data validations & calculations (selected SQL/RPC outlines)

### 16.1 Lot/date code generation

```sql
create or replace function gen_lot_code(pattern text, batch_id uuid, sku_code text, at timestamptz)
returns text language sql as $$
  select replace(
           replace(
             replace(
               replace(pattern, '{YY}', to_char(at, 'YY')),
             '{YYYY}', to_char(at, 'YYYY')),
           '{JJJ}', to_char(at, 'DDD')),
         '{BATCH}', left(batch_id::text, 8))
  || '-' || sku_code;
$$;
```

### 16.2 Packaging run (transactional)

```sql
-- Pseudocode / plpgsql outline
create or replace function create_packaging_run(p jsonb) returns uuid as $$
declare
  run_id uuid := gen_random_uuid();
begin
  perform assert_entitlement('packaging');
  perform validate_materials_available(p);
  insert into packaging_runs(...) values (...) returning id into run_id;
  perform allocate_and_consume_sources(p->'sources', run_id);
  perform consume_packaging_materials(p->'materials', run_id); -- FIFO or override with COGS delta
  perform produce_finished_lots(p->'outputs', run_id);
  perform write_inventory_transactions(run_id);
  perform write_audit('packaging_runs', run_id, 'command', null, to_jsonb(run_id));
  return run_id;
end; $$ language plpgsql security definer;
```

### 16.3 BROP reconciliation check

```sql
create or replace function validate_reconciliation(period_id uuid) returns void as $$
begin
  -- raises exception if out of balance (or inserts anomaly warnings per settings)
end; $$ language plpgsql;
```

---

## 17) Notifications & scheduled jobs (pg\_cron + jobs)

* **Daily digest** per workspace: low stock, open POs due, tank milestones, BROP/Excise due, pending transfers.
* **Supplier price spikes** detection job.
* **Snapshot retention** check (≥3 years) with export reminder.
* **Outbox health** telemetry rollups.

---

## 18) Entitlements, roles & permissions (practical matrix)

* **Admin**: all; integrations/entitlements management.
* **Brewer**: recipes create/edit; batches; ferm logs; packaging; **no costs** (unless `brewer_plus` flag).
* **Inventory**: receive/adjust/transfer; POs (create/receive); costs visible.
* **Accounting/Compliance**: costs visible; BROP/Excise/Reports; approve POs.
* **Contract Brand**: read‑only limited to `owner_entity_id` scope; can download their snapshots & transfer docs.

Enforced by: route middleware (UI), RLS policies (DB), entitlement checks (RPC).

---

## 19) UX implementation notes (key screens)

* **Brew Day**:

  * Large touch targets; offline banner; timers persisted in IndexedDB; COGS delta chip on lot overrides.
* **Tank board**:

  * Realtime updates via channel on `ferm_readings`/`batches`; inline “Harvest yeast?” chips.
* **PO receiving**:

  * Scanner + manual; variance banner; price history side panel.
* **Compliance Center**:

  * Period selector with due date; reconciliation grid; anomalies list; “Generate draft” → “Finalize & snapshot”.

---

## 20) Rollout plan (aligned to PRD phases)

**Phase 0 — Discovery/Design**

* Finalize compliance mappings; define CSV schemas; confirm entitlements; design Outbox & PWA scaffolding.

**Phase 1 — Core build**

* Schemas + RLS; Recipes; Inventory; POs; Batches/Tanks; Yeast; Packaging (blends/codes); Dashboard; Imports/Exports; Audit; PWA outbox.

**Phase 1.5 — Compliance & ingest**

* BROP + Excise engine; In‑bond transfers; Sales ingest; QBO CSV; alerts/digests.

**Closed Beta**

* 8–12 breweries; activation & compliance success reviews; seed data & onboarding wizards; error telemetry hardening.

**GA**

* Pricing + setup packages in Stripe; docs; webinars; support runbooks.

**Post‑GA**

* QBO one‑way post; Sales Orders; SSO; API keys/webhooks.

---

## 21) Risks & technical mitigations (implementation‑specific)

| Risk                                           | Impact | Mitigation                                                                                              |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| RLS complexity causes accidental data exposure | High   | “Default deny” policies; integration tests for every table policy; code reviews for all policy changes. |
| Long‑running PDF generation on serverless      | Medium | Run in Edge Function with streaming; fallback worker queue; pre‑render templates where possible.        |
| Offline conflicts on inventory ops             | Medium | Idempotency keys; domain transactions validate preconditions; guided rebase UI.                         |
| Compliance edge cases                          | High   | Configurable mapping tables; “adjustment” entities with audit; pilot breweries validation before GA.    |
| Stripe entitlements drift                      | Medium | Central `entitlements` table as single source; webhook idempotency; nightly reconciliation job.         |
| High‑volume ferm readings                      | Medium | Monthly partitioning; lightweight payloads; summary aggregates.                                         |

---

## 22) Developer ergonomics

* **Shared types:** `packages/zod-schemas` generate TS types for client/server parity.
* **SDK:** Lightweight `@brewcrush/api` with typed wrappers over RPCs and PostgREST calls.
* **Feature flags:** `features` table + env gating for beta toggles.
* **Command line:** `pnpm dev` runs web + edge‑fns locally; `supabase start` for local DB.

---

## 23) Appendix A — Core SQL types & tables (condensed)

```sql
-- Enums
create type role as enum ('admin','brewer','inventory','accounting','contract_viewer');
create type item_type as enum ('raw','packaging','finished','misc');
create type inv_txn_type as enum ('receive','consume','adjust','transfer','produce','package','ship','destroy','return','in_bond');
create type po_status as enum ('draft','approved','partial','received','closed');

-- Tenancy
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'trial',
  stripe_customer_id text,
  settings jsonb not null default '{}'::jsonb
);

create table user_workspace_roles (
  user_id uuid not null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  role role not null,
  primary key (user_id, workspace_id)
);

-- Inventory (sample)
create table items(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  type item_type not null,
  uom text not null,
  conversions jsonb not null default '{}'::jsonb,
  reorder_level numeric,
  unique(workspace_id, name)
);

create table item_lots(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  item_id uuid not null references items(id),
  lot_code text not null,
  qty numeric not null,
  uom text not null,
  unit_cost numeric,
  expiry date,
  location_id uuid not null,
  unique(workspace_id, item_id, lot_code)
);
```

*(Remaining tables follow the structures in §2; full DDL delivered with migrations.)*

**RLS activation template:**

```sql
alter table items enable row level security;
create policy tenant_select on items for select using (workspace_id = get_jwt_workspace_id());
create policy tenant_mod on items for insert with check (workspace_id = get_jwt_workspace_id());
```

---

## 24) Appendix B — Webhooks & domain events

**Outgoing webhooks (per PRD):**
`batch.created`, `inventory.low_stock`, `ttb.finalized`, `excise.worksheet_generated`, `po.received`.
Delivery with retries (exponential backoff), HMAC signatures; subscription management via API keys (Growth+).

**Telemetry (UI events):**
`po_created`, `po_received`, `yeast_pitch_logged`, `yeast_harvest_logged`, `pos_ingest_completed`, `excise_worksheet_generated`, `inbond_transfer_created`, `recall_drill_opened`, with `offline_queued` flag.

---

## 25) Appendix C — File imports & exports

* **Imports:** Items & lots, Recipes, Tanks, Vendors/Customers, POS Sales, Transfers in bond; competitor CSV presets.
* **Exports:** Inventory, transactions, batches, packaging, TTB detail, excise worksheet, sales removals, keg deposit ledger.
* **CSV safety:** delimiter detection; UTF‑8 normalization; per‑row error files; idempotency per file hash.

---

## 26) Appendix D — Labels/printing

* PDF sizes: A4/Letter plus 4x6"; configurable DPI; ZPL export (later).
* Lot/date code shown on label with batch ID short hash; printer calibration guide.

---

## 27) Appendix E — Access patterns (query hints)

* **Tank board:** `select * from batches where status in ('fermenting','brite') order by updated_at desc` + latest `ferm_readings` join.
* **Recall drill:** start from `finished_lots` → join `packaging_run_sources` → join `inventory_transactions` of type `consume` → traverse to `item_lots` (raws) + `removals`.
* **Supplier price trend:** `supplier_price_history` timeseries window with `avg`, `p95`, anomaly z‑score.

---

## 28) What success looks like (engineering)

* **Offline sync** success rate ≥ 99.5% within 5 minutes of reconnect.
* **BROP & Excise** generation pass pilot brewery audits; snapshots immutable and downloadable.
* **PO lifecycle** solid: partials, variances, supplier trend visible.
* **Yeast generations** accurately tracked; prompts timely; no lost logs.
* **Stripe entitlements** correctly gate features; plan changes seamless.

---

### Final note

This blueprint is intentionally concrete around **schema, RLS, domain RPCs, offline mechanics, compliance pipelines, and entitlements** so the team can stand up the first vertical slices quickly (Recipes → Batch → Packaging → BROP). The DDL, RPC functions, Edge Functions, and CI scaffolding can be generated from this plan without re‑deciding core patterns.
