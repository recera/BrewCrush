BrewCrush — Product Requirements Document (PRD)

Version: v1.1 (Aug 2025) • Status: Draft for stakeholder sign‑off
Owner: Product

0) Executive summary

Problem. Small breweries outgrow spreadsheets quickly. Daily realities—recipes, batches, yeast management, inventory, POs, packaging, and compliance (BROP + excise)—are brittle across tools. Existing ERPs feel heavy and charge per seat, choking adoption on the floor.

Vision. The easiest way for a small brewery to plan, brew, package, track, and file—from grain to TTB (BROP + excise)—on desktop, tablet, and phone. Offline‑safe in the brewhouse. Unlimited users.

MVP outcome. A brewer can:

Create a recipe → 2) Schedule & brew a batch → 3) Consume tracked inventory (with PO‑driven costs) → 4) Log fermentation (with yeast generation tracking) & package (with blends & date/lot codes) → 5) Auto‑compute costs & on‑hand → 6) Generate BROP and prepare excise return (with transfers in bond and contract brewing scenarios) → 7) Ingest basic POS sales to post removals.

Pricing intent. Transparent monthly tiers by production, unlimited users, optional setup packages to fund migration (see §14).

Go/no‑go metric. ≥70% of pilot breweries abandon spreadsheets/legacy for daily production/inventory and complete both a BROP draft and an excise return worksheet in month 1.

CHANGED (Scope promotions):

Purchase Orders → Must‑Have

Yeast management (pitch/harvest/generation) → Must‑Have

Excise tax return prep (TTB F 5000.24) → Must‑Have

Transfers in bond (incl. not same ownership) → Must‑Have

Simple POS/Sales ingest → Must‑Have

1) Goals & non‑goals
1.1 Product goals (MVP, US market)

Replace manual/fragmented tooling for production + inventory + purchasing + compliance. CHANGED

Deliver TTB‑ready BROP and excise return prep with minimal manual work. CHANGED

Provide mobile/tablet‑first brewhouse flows with offline queue.

Be affordable and unlimited‑user (no per‑seat friction).

Offer data portability & assisted migration paths.

1.2 Business goals (first 12 months)

100 paying U.S. micro/craft breweries (<5k BBL/year).

NRR ≥ 105%. Gross churn ≤ 2%/mo.

CSAT ≥ 4.6/5; NPS ≥ 40.

CAC payback < 6 months (supported by optional setup fee).

1.3 Non‑goals (MVP)

No built‑in POS, route optimization, or keg‑IoT.

No full GL; integrate/export to QuickBooks/Xero.

No international filings outside U.S. TTB in MVP.

2) Target users & personas
Persona	Primary jobs-to-be-done	Devices	Success signals
Head Brewer	Plan schedule; brew; log readings; manage tanks/yeast	Tablet; phone; desktop	Runs brew day sans paper; <2 min per log; tank/yeast availability at a glance
Assistant Brewer / Cellar	Execute steps; record readings; transfers; CIPs	Phone, tablet	Minimal taps per log; clear tasks; offline‑safe
Owner/GM	See margins, volumes, costs; approve POs; compliance	Desktop	One dashboard; clean BROP + excise worksheets
Inventory/Purchasing	Stock counts; receiving; POs; low‑stock alerts	Desktop; tablet + scanner	Accurate on‑hand; faster receiving; stable costs
Bookkeeper/Accountant/Compliance	COGS; excise; BROP; QBO/Xero exports	Desktop	Reconciles without manual math; audit trail
Host/Contract Brand (NEW)	Track contract batches; transfers in bond; allocations	Desktop	Correct ownership on reports; clean transfer docs
Sales/Distribution (Phase 2)	Orders, allocations, simple CRM	Phone, desktop	Not in MVP (see roadmap)
3) Scope overview (MoSCoW)
3.1 Must‑have (MVP)

Recipe management (scalable formulas; versioning; cost rollup; QA spec table). NEW

Batch management (plan → brew → ferment → package; batch ID; blends/splits at packaging). CHANGED

Yeast management (strain, lab/source, generation, pitch/harvest, viability notes). NEW

Fermentation/tank tracking (readings; statuses; occupancy; CIP status). CHANGED

Inventory (raws/packaging/finished goods; lots; transactions; supplier price history).

Purchase Orders (create → approve → receive; 3‑way check; costs update). PROMOTED

Packaging runs (kegs/cans/cases; yields; date/lot code templates; finished lots).

Keg deposit ledger (minimal) (liability up/down; export to QBO). NEW

TTB BROP generation (monthly 5130.9 / quarterly 5130.26 scenarios; snapshots). CHANGED

Excise tax return prep (5000.24 worksheet; due‑date reminders). NEW

Transfers in bond (bulk/packaged; same/different ownership; doc export). NEW

Contract brewing / alternating proprietorship (ownership attribution & filings). NEW

Basic POS/Sales ingest (CSV/API) to post removals for consumption/sale. NEW

Dashboards & core reports (on‑hand; batch costing; production summary; recall drill). CHANGED

Multi‑user & roles (Admin, Brewer, Inventory, Accounting/Compliance; optional Contract Brand viewer). CHANGED

Responsive UX with offline outbox for brewhouse tasks.

CSV import/export (inventory, recipes, customers, vendors, POS).

Audit logs & data snapshots (BROP/excise).

Basic QBO/Xero export (CSV) + Phase 1.5: one‑way QBO post (journals/invoices).

3.2 Should‑have (near‑term)

Basic Sales Orders (enter → allocate → ship/deduct).

Email/Push notifications (low stock; tank milestones; due dates).

API keys (read/export) & webhooks.

Google/Microsoft SSO for Admins.

Two COGS methods configurable: Actual lots consumed and Moving average; “latest cost” for inventory value. NEW

3.3 Could‑have (later)

Keg tracking (scan in/out; custody).

Delivery runs (manifests; basic routing).

Sensor integrations (Tilt, Plaato, etc.).

Two‑way accounting sync; Advanced QA/Lab; Distributor portal.

3.4 Won’t‑have (MVP)

POS, full ERP MRP, payroll/HR, route optimization, international filings.

4) Success metrics & analytics

Activation

Time to first batch ≤ 48h from workspace creation.

≥ 80% import inventory or create 10+ items week 1.

NEW: First PO created and received within 14 days for ≥60% of breweries.

NEW: First yeast pitch logged within 14 days for ≥50% of breweries.

Engagement

≥ 3 production sessions/week in month 1.

≥ 75% of batches with ≥ 5 ferm readings.

NEW: ≥ 50% of batches have yeast generation captured.

NEW: ≥ 70% of packaging runs use date/lot code templates.

Value/Outcome

≥ 70% generate a BROP in first reporting period.

NEW: ≥ 70% complete an excise worksheet in first period.

90% of batches have calculated COGS (show method used).

NEW: 100% of transfers in bond have matching docs/snapshots.

Reliability

Uptime ≥ 99.9%; p95 API < 400 ms; p95 TTI < 2.5 s.

NEW: Offline outbox successful sync rate ≥ 99.5% within 5 minutes of reconnect.

Event instrumentation (additions)
po_created, po_received, yeast_pitch_logged, yeast_harvest_logged, pos_ingest_completed, excise_worksheet_generated, inbond_transfer_created, recall_drill_opened.

5) Competitive notes (context)

Keep brewer‑first mobile flows; incumbents skew to management heavy.

Accounting integrations & TTB automation are table stakes; excise prep + transfers in bond raise trust.

Unlimited users remains a key wedge.

6) Detailed requirements by capability
6.1 Recipe management

Objectives

Single source of truth; scaling; cost rollup; QA spec table (OG/FG/IBU/ABV/pH ranges).

Key features

Versions (immutable), % or weight/volume; steps/phases with timers.

Scaling by target wort volume; efficiency %; loss factors.

Cost rollup from latest ingredient cost; overhead% global/per‑recipe.

QA Specs (NEW): target ranges; show on brew sheet; compare actuals.

UX

Recipe list (search/filter).

Recipe detail tabs: Overview, Ingredients, Steps, Costing, Specs, Versions. CHANGED

“Use for batch” CTA.

Validation

Units compatibility; warn on missing costs/specs.

Permissions

Brewer create/edit; Accounting sees costs; Admin lifecycle.

6.2 Inventory management

Objectives

Accurate raw/packaging/finished inventory; lots; traceability; supplier price history; keg deposit ledger.

Entities

Item (Raw/Packaging/Finished/Misc), ItemLot, InventoryLocation, InventoryTransaction, KegDepositEntry (NEW).

Features

Receipts create lots with qty/unit/cost; FIFO preference; low stock thresholds.

Unit conversions; bulk import; cycle counts.

Supplier price history (NEW): keep last N receipts with unit cost.

Keg deposit ledger (NEW): track deposit charged/returned; export to QBO liability.

UX

Item catalog (on‑hand/order/committed/status).

Item detail: lots, transactions, reorder level, vendor, last prices.

Keg deposit ledger accessible from Finished SKU and Reports.

Validation

Prevent negative stock unless Admin override (logged).

6.3 Purchasing — POs (PROMOTED to MVP)

Objectives

Cost control and three‑way match: PO → receipt → bill.

Entities

PurchaseOrder { status: Draft/Approved/Partial/Received/Closed; vendor; terms }

PoLine { item, qty, unit, expected cost, due, location }

BillRef (Phase 1.5 for QBO post)

Features

Create, approve (role‑gated), receive against PO with lot codes/expiry; partial receipts.

Auto‑update latest cost; record supplier price history.

Reorder suggestions (low‑stock report → create PO).

CSV import/export; vendor catalog.

UX

Purchasing section: PO list; create wizard; receiving against PO.

Validation

Receiving cannot exceed ordered qty unless override; cost variances surfaced.

6.4 Batches, fermentation, tanks & yeast (NEW)

Objectives

Plan/execute batches; integrate yeast lifecycle; blends/splits; CIP visibility.

Entities

Batch, Tank, FermReading, PackagingRun, YeastBatch (strain, source, generation, pitch/harvest, notes) NEW

Workflow

Plan: Create batch; schedule; assign tank; preflight (low stock, tank/CIP, yeast availability).

Brew: Mobile checklist; actuals (OG, volumes); auto‑consume inventory; link YeastBatch (pitch).

Ferment: Daily readings; status changes; Yeast harvest increments generation and creates inventory entry if tracked.

Package: Into kegs/cans/bottles; blend multiple batches; set date/lot code; create finished lots; compute COGS.

Close: Batch summary (yield %, variances, COGS).

UX

Production calendar (tanks as lanes; drag/drop).

Brew Day mobile checklist (large inputs, offline queue).

Tank board with SG/temp, days in tank, CIP status, next action.

Yeast dashboard (NEW): active pitches, generations, harvest ready.

Validation

Block packaging if packaging materials insufficient (warn/block per setting).

Blends require all source batches in compatible status; allocations by volume.

Yeast generation increments on harvest; warn if over max gen set per strain.

6.5 Packaging & finished goods (CHANGED)

Objectives

Precise conversion to sellable units with labels and lot/date codes.

Features

Define FinishedGood SKUs (keg/can/bottle; size; pack).

Packaging run consumes packaging materials → outputs finished lot(s).

Blends supported; COGS allocated by volume. NEW

Lot/date code templates (e.g., YYJJJ-BATCH-SKU); preview & lock. NEW

Printable labels/manifests.

UX

Packaging wizard: select batch(es) → format → materials check → yields/loss → code preview → post & print.

6.6 Sales ingest & removals (NEW)

Objectives

Ensure TTB removals reflect reality without manual entry.

Features

One‑lane ingest: CSV template (date, SKU, qty, destination type: taproom/distributor, doc#) and a simple REST endpoint.

Map to InventoryTransaction: Ship/Remove with reason Consumption/Sale.

Option to group taproom same‑day removals.

UX

Compliance → Sales Ingest: upload, map, validate, preview impacts; failures exportable.

6.7 Compliance — BROP, Excise, Transfers, Contract (CHANGED)

Objectives

Generate the Brewer’s Report of Operations (BROP), prepare excise return worksheet, and handle transfers in bond and contract/alternating proprietorship.

Inputs

Production volumes; losses; removals; returns; destructions; transfers (bulk/packaged).

Contract/ownership data per batch/lot.

Features

Period selection (monthly/quarterly as configured).

Data Check: missing readings, negative stock, reconciliation mismatch, unposted removals.

Transfers in bond (NEW): transaction type with shipping/receiving brewery details, ownership, container type; printable document.

Contract/Alternating (NEW): owner of record on batch; filings attributed correctly.

Excise worksheet (NEW): compute taxable removals and produce a reviewable worksheet for Pay.gov entry.

Exports: PDF (BROP), CSV line detail; snapshot with audit trail; due‑date reminders.

UX

Compliance Center: period header with due date; form type; data checks; reconciliation grid; anomalies list; “Generate draft” → “Finalize & snapshot”.

Validation

Reconciliation: opening + production − losses − removals + returns = closing; variances flagged.

Transfers require complete counterpart details; contract batches require owner attribution.

6.8 Reporting & dashboards (CHANGED)

Dashboards

In fermenters/bright; packaged this week; upcoming brews; open POs; yeast status; low stock; TTB status (BROP + excise).

Owner/Accounting: COGS/unit (last 5), inventory value, deposit ledger, compliance progress.

Reports

Inventory on hand (by item/location/lot; value options).

Batch summary (yield, cost breakdown, timeline).

Production summary (by style/SKU).

Packaging output (units by SKU).

COGS summary (ingredients/packaging/overhead).

Recall drill (NEW): from finished lot → upstream ingredient lots and downstream shipments.

PO aging (NEW); Supplier price trend (NEW); Keg deposit ledger (NEW).

Export

Print/CSV; saved views.

6.9 Users, roles & permissions (CHANGED)

Roles: Admin • Brewer • Inventory • Accounting/Compliance • Contract Brand (read‑only selected data)

Capability	Admin	Brewer	Inventory	Accounting/Compliance	Contract Brand
Invite users / roles	✔️				
Recipes create/edit	✔️	✔️			
Batches create/execute	✔️	✔️			
Ferm readings / Brew Day	✔️	✔️			
Packaging runs	✔️	✔️	✔️		
Inventory receive/adjust/transfer	✔️		✔️		
POs create/approve/receive	✔️		✔️	Approve ✔️	
Costs view	✔️	(opt)	✔️	✔️	
Reports/BROP/Excise generate	✔️			✔️	Read snapshot
Transfers in bond create/print	✔️	✔️	✔️	✔️	Read snapshot
Integrations configure	✔️				
6.10 Imports/exports & integrations

Imports: Items & lots; Recipes; Tanks; Vendors/Customers; POS sales; Competitor CSV mappers (Ekos/Beer30/Ollie/Breww—mapping presets).
Exports: Inventory, transactions, batches, packaging, TTB detail, excise worksheet, sales removals.
Accounting: Phase 1 CSV; Phase 1.5 one‑way QBO post (journals/invoices) with mapping UI.
Webhooks: batch.created, inventory.low_stock, ttb.finalized, excise.worksheet_generated, po.received.

6.11 Notifications & tasks

Daily digest: low stock; open POs due; tank milestones; BROP/excise due dates; transfers pending.

Inline “Crash today?”/“Harvest yeast?” chips on tank cards.

6.12 Help, onboarding & support

Guided setup: add tanks → import items/lots → add yeast strains → create recipe → schedule batch → start brew → receive PO → run packaging → generate BROP/excise drafts.

Sample data workspace; contextual tooltips; in‑app chat; 24–48h email SLA; office hours.

“Brew Day Mode” explainer; offline banner & outbox status.

7) Information architecture (CHANGED)

Top nav (desktop): Dashboard • Purchasing • Production • Inventory • Recipes • Packaging • Reports • Compliance • Settings
Mobile tabs: Home • Production • Inventory • Reports • More
Key routes:
/dashboard • /purchasing/pos • /recipes /recipes/:id • /batches /batches/:id (brewday) • /tanks • /packaging • /inventory/items /inventory/receiving • /reports • /compliance/ttb /compliance/excise /compliance/transfers • /settings

8) UX patterns & flow specs (expanded)
8.1 Brew Day (mobile/tablet)

Checklist with timers; autosave; undo; offline queue with visible outbox counter.

Lot override shows COGS delta (pre‑post preview). NEW

Assign fermenter; link YeastBatch; warn on CIP conflicts.

8.2 Fermentation logging

Quick Log: SG/temp/pH with numeric keypad; sparkline; offline queue.

Yeast prompts (e.g., “Harvest today?” based on schedule). NEW

8.3 Packaging wizard

Materials check (warn/block).

Blends picker; volume allocations; date/lot code template preview.

Post → finished lots, labels, manifests, COGS/unit.

8.4 Inventory receiving

Against PO or ad‑hoc; scan; lot#/expiry/cost; location assign; partials; variances flagged.

8.5 TTB Center

Period (month/quarter); due‑date banner; form type shown.

Reconciliation grid; anomalies; adjustments with audit; BROP PDF/CSV; snapshot.

Excise worksheet tile with Pay.gov helper text (no e‑file in MVP). NEW

8.6 Sales ingest

Upload CSV or POST data; field mapping; preview removals; error CSV.

8.7 Transfers in bond

Wizard: choose bulk vs packaged; enter shipper/receiver, ownership, branding/marking, container details; generate printable doc; post inventory movement.

8.8 Yeast management

Strain registry (source, attenuation, recommended max gens).

YeastBatch detail (pitch/harvest timeline, generation, notes).

Prompts on schedule and tank board.

9) Data model (ERD‑level, CHANGED/NEW)

Core entities (UUID PKs unless noted)

Workspace, User, Role, UserRole

Item, ItemLot, InventoryLocation, InventoryTransaction { type: Receive, Consume, Adjust, Transfer, Produce, Package, Ship, Destroy, Return, **InBond** } CHANGED

Recipe, RecipeVersion, RecipeIngredient

Tank, Batch { ownerEntityId? (for contract/alt prop), inBondFlag? } NEW fields

FermReading

PackagingRun { batchIds[], skuId, at, units, loss, finishedLotIds[] } CHANGED to support blends

FinishedSku

Vendor, PurchaseOrder, PoLine

YeastBatch { strain, source, generation, pitchAt, harvestAt?, viabilityNotes, linkedBatchIds[] } NEW

InBondTransfer { fromBrewer, toBrewer, sameOwnership bool, bulkOrPackaged, container, quantities, docsUrl } NEW

Removal { finishedLotId, qty, reason: Sale|Consumption|Testing|Destroyed|Return, docRef } NEW

KegDepositEntry { customerId, skuId, qty, amount, direction: Charged|Returned } NEW

TTBPeriod, TTBEntry, ExciseWorksheet NEW

Attachment, AuditLog

Indices & constraints

(Item.workspaceId, Item.name) unique; RLS by workspaceId.

Index InventoryTransaction.refType, refId; partitions for FermReading.

Ownership & in‑bond fields indexed for compliance reports.

Retention

Keep required records ≥ 3 years; snapshots for BROP/excise; export on request.

10) System architecture & NFRs

Frontend: Next.js (React) SPA/SSR; PWA; responsive; offline outbox for brew/ferm/pack logs & sales ingest.
Backend: Node.js (TypeScript) REST (OpenAPI); job queue (Redis/BullMQ) for imports/exports/snapshots.
DB: PostgreSQL; S3‑compatible storage; RLS multi‑tenant.
Auth: Email/password; optional Google/Microsoft SSO (near‑term).
Integrations: Integration Service for QBO (one‑way first); webhooks.
Perf SLOs: p95 API < 400 ms; p99 < 750 ms; heavy ops < 5 s.
Availability: 99.9% uptime; daily full + 15‑min WAL; RPO 15 min; RTO 4 h.
Security: TLS 1.2+; AES‑256 at rest; KMS secrets; RBAC server‑side; immutable audit; tenant isolation via RLS; per‑tenant envelope keys.
Compliance posture: SOC 2 Type 1 readiness roadmap (6–9 months).
Accessibility: WCAG 2.1 AA; reduced motion; large tap targets.

11) API design (selected endpoints; CHANGED/NEW)

Auth
POST /v1/auth/login • POST /v1/auth/invite

Recipes
GET/POST /v1/recipes • POST /v1/recipes/:id/versions • POST /v1/recipes/:id/use

Inventory
GET/POST /v1/items • GET /v1/items/:id/lots • POST /v1/receipts • POST /v1/adjustments • POST /v1/transfers

Purchasing (NEW)
GET/POST /v1/pos • POST /v1/pos/:id/approve • POST /v1/pos/:id/receive • PATCH /v1/pos/:id

Production
GET/POST /v1/batches • PATCH /v1/batches/:id • POST /v1/batches/:id/ferm-readings • POST /v1/batches/:id/package (supports sourceBatchIds[]) CHANGED

Yeast (NEW)
GET/POST /v1/yeast-batches • POST /v1/yeast-batches/:id/pitch • POST /v1/yeast-batches/:id/harvest

TTB/Compliance (CHANGED/NEW)
POST /v1/ttb/periods • GET /v1/ttb/periods/:id • POST /v1/ttb/periods/:id/finalize • GET /v1/ttb/periods/:id/export?format=pdf|csv
POST /v1/excise/worksheets • GET /v1/excise/worksheets/:id/export NEW
POST /v1/inbond-transfers • GET /v1/inbond-transfers/:id/doc NEW

Sales ingest (NEW)
POST /v1/sales-ingest/csv • POST /v1/sales-ingest/events

Reports
GET /v1/reports/inventory-on-hand • GET /v1/reports/batch-summary • GET /v1/reports/production • GET /v1/reports/recall-drill NEW

API notes
Cursor pagination; idempotency keys; rate limits. All “postings” write audit logs and support preview endpoints for “dry run”.

12) Data validations & calculations (highlights, CHANGED/NEW)

Units: Central catalog; explicit conversions; enforce across recipes/batches/POs.

Scaling: Target cast‑out volume; brewhouse efficiency %; predicted OG.

COGS methods (NEW):

Actual lot costs consumed (default for COGS).

Moving average (alternative).

Inventory valuation may use latest cost.

Show method used on all cost reports/exports.

Blending (NEW): Allocate COGS by contributing batch volumes; persist allocation on PackagingRun.

Lot/date code templates (NEW): Validated patterns with tokens: {YY}, {YYYY}, {JJJ}, {BATCH}, {SKU}; collision check.

Keg deposits (NEW): Post ledger entries; export to QBO liability account mapping.

TTB/BROP & Excise: Reconciliation rule enforced (warning/hard stop per setting).

Transfers in bond: Validate shipper/receiver IDs, ownership, and container type; generate doc number; inventory moves in bond without tax.

13) QA plan & acceptance criteria (additions)

User story: As purchasing, I can create/approve/receive a PO and update costs.
AC: PO lifecycle works; partial receipts; supplier price history updates; variance flags.

User story: As a brewer, I can manage yeast generations.
AC: Create YeastBatch, link to batch at pitch; harvest increments generation; prompts; readings visible.

User story: As compliance, I can prepare BROP and excise returns.
AC: Data check surfaces issues; BROP PDF/CSV + snapshot; Excise worksheet generated; due‑date banner visible.

User story: As operations, I can record transfers in bond.
AC: Wizard collects all required fields; posts in‑bond movement; prints doc; appears in compliance reports.

User story: As accounting, I can ingest POS sales and see removals.
AC: CSV mapping; removals posted; conflicts/errors exportable; totals match POS day summary.

14) Pricing & Billing — MVP (Same Features Across Tiers)
14.1 Goals & constraints

Simplicity for launch: one feature set, three prices by annual production (BBL).

Zero-friction onboarding: no documents or verification at signup.

Fair & transparent: automatic, soft tier suggestions based on observed packaging volume; no retro charges.

Unlimited users on every plan; 1 workspace per account.

14.2 Public plans (list pricing)

All plans include the exact same product features (see §14.3). Only the price changes by production scale.

Plan (by annual BBL)	Who it fits	Pay monthly	Pay annually (–15%)
Starter (≤ 1,000 BBL/yr)	Nanos & early micros	$40	$34 / mo
Growth (1,001–3,500 BBL/yr)	Most micros	$85	$72 / mo
Pro (3,501–10,000 BBL/yr)	Larger craft / contract	$200	$170 / mo

Optional setup packages (one-time): $299 Basic import • $899 White-glove import • $1,499 Legacy switch + “BROP/Excise rehearsal”.

14.3 Included features (identical across all tiers)

Core production: Recipes (versions/specs), Batches, Tanks, Yeast generations, Brew Day (offline outbox), Packaging (blends, lot/date codes), Finished Lots.

Inventory & purchasing: Items/Lots, Locations, Unit conversions, POs (create/approve/receive), Cycle counts, Supplier price history.

Compliance: BROP (monthly 5130.9 / quarterly 5130.26), Excise worksheet (5000.24 prep), Transfers in bond (same/different ownership), Contract/Alternating attribution, Snapshots.

Sales ingest: CSV/API lane for removals (taproom/distributor).

Traceability & reports: Recall drill, Inventory on hand, Batch/COGS, Production/Packaging, PO aging, Supplier price trend, Keg deposit ledger.

Data & access: Unlimited users, CSV import/export, Webhooks/API (read + ingest), QBO/Xero CSV exports.

Security & reliability: RBAC, audit logs, RLS multitenancy, PWA offline outbox.

MVP note: Support is the same for all tiers (email support, 24–48h SLA). We can introduce SSO/SLA tiers later without changing price bands.

14.4 Signup flow (self-attested BBL)

Step: “How many BBL did you produce in the last 12 months?”
Choices: ≤1,000 • 1,001–3,500 • 3,501–10,000.

Attestation checkbox: “I confirm this is accurate to the best of my knowledge.”

Plan selection: Auto-selects tier + monthly/annual choice. No document uploads.

14.5 Observed Production (OP) soft-check (no paperwork)

Intent: Keep pricing honest with zero friction. We suggest (not force) tier changes when real activity exceeds the band.

Metric:
OP_annualized = (Σ packaged_BBL over last 90 days / 90) × 365
(packaged_BBL derived from PackagingRuns → SKU volume conversions)

Thresholds & cadence:

Grace band: Up to +10% above tier cap does not trigger action.

Trigger: OP exceeds cap by >10% for two consecutive calendar months.

Check: Weekly background job computes OP & evaluates triggers.

Customer experience (banner + email):
“Looks like you’re tracking ~1,150 BBL/yr. We’ll move you to Growth ($85/mo) on your next renewal (in 14 days). Need help? Contact us.”
Buttons: Accept now (apply immediately) • Talk to us (opens support)
No retro charges. Default is change at next renewal.

Downgrades: If OP falls below a lower tier for 3 consecutive months, show a “Downgrade available” banner; change at next renewal if accepted.

Edge cases: Support can apply an override (pin tier, extend grace) per account (e.g., festival spikes, contract-only brewing).

14.6 Plan change policy

Effective date: By default, next renewal (monthly or annual).

Immediate changes: Allowed via Accept now (user-initiated); invoice prorates forward only.

No retroactive billing/credits for OP-based changes.

Notifications: In-app banner + email; reminders at T–14, T–3, and T–0 days.

14.7 Billing mechanics

Billing provider: Stripe.

Trials: 14 days full product; no card required (configurable).

Invoices: Emailed PDFs; Billing page shows history & next renewal.

Annual discount: –15% applied at checkout; auto-renew by default.

Failures & dunning: 3 retries over 14 days; read-only mode after failure window (no data loss).

14.8 Setup packages (optional, same for all tiers)

Basic ($299): CSV mapping session (Items/Lots/Tanks/Recipes), 60-min screen-share, import validation.

White-glove ($899): We convert legacy sheets, recreate 3 recipes, 1 brew dry-run, POS ingest dry-run.

Legacy switch ($1,499): Everything in White-glove + BROP/Excise rehearsal and go-live support on filing week.

Refund policy: 30-day money-back if “brew to BROP” activation goal isn’t met and it’s our fault (import or product defects).

14.9 UI/UX specs
14.9.1 Pricing page (marketing site)

Copy blocks:

“Unlimited users on every plan—no per-seat tax.”

“Pick your plan by annual BBL. We use a fair, automatic check to suggest changes based on your packaging—no paperwork.”

“No surprise bills. Changes happen at your next renewal unless you accept earlier.”

FAQ modal: “How do you calculate production?” → shows OP formula, grace band, and examples.

14.9.2 Signup (app)

Step after workspace name: BBL attestation radio group + checkbox; plan picker; monthly vs annual toggle; total due.

14.9.3 Settings → Billing

Plan card: current tier, renewal date, payment method, invoices.

Observed Production card: OP_annualized with last 90-day trend sparkline; tier bands visualized; status pill (Within band / Near cap / Over cap).

Change plan CTA (opens plan dialog).

Setup packages purchase button.

14.9.4 OP suggestion banner (global)

Appears to Admins only; persistent until accepted/dismissed; links to Billing.

14.9.5 Emails (transactional)

Plan suggestion (upgrade/downgrade) at detection; reminders at T–14/T–3/T–0; confirmation after change.

14.10 Data model (additions)

BillingPlan { id, name: Starter|Growth|Pro, bbl_min, bbl_max, price_monthly, price_annual_monthly_equiv, is_active }

AccountBilling { workspaceId, planId, billing_period: Monthly|Annual, renewalAt, stripeCustomerId, overrideTier? }

ObservedProductionSnapshot { workspaceId, date, packaged_bbl_90d, op_annualized_bbl }

PlanChangeSuggestion { workspaceId, suggestedPlanId, reason: OP_EXCEEDS|OP_BELOW, firstDetectedAt, effectiveAtDefault, status: Suggested|Accepted|Dismissed|Overridden, actedBy? }

Invoice (Stripe mirror) / PaymentMethod metadata as needed.

14.11 API (additions)

GET /v1/billing/plan → current plan & renewal

POST /v1/billing/plan → change plan { planId, when: "now"|"renewal" }

GET /v1/billing/op → OP snapshots, current status

POST /v1/billing/suggestions/:id/accept

POST /v1/billing/suggestions/:id/dismiss

Admin (internal): POST /v1/billing/override (support use only)

All POSTs write AuditLog entries (billing.plan_changed, billing.suggestion_acted).

14.12 Telemetry & KPIs

Events

pricing_page_view, signup_bbl_attested, billing_plan_changed {from,to,when}

op_snapshot_written {op_annualized_bbl}

op_suggestion_shown/accepted/dismissed

setup_package_purchased {type}

KPIs

Trial→Paid conversion by tier & billing period

% on annual vs monthly

Setup attach rate & average setup revenue

% of accounts getting OP suggestions; accept rate; dispute rate

Churn by tier; top churn reasons

14.13 QA & acceptance criteria

Story: As a new customer, I can choose a plan by attesting BBL without verification.

AC: Plan selection requires radio choice + attestation; plan created; no document upload.

Story: As an admin, I see an accurate OP suggestion when my observed production exceeds the band.

AC: With seed data for 90d packaging totaling > cap×0.9, the banner appears within 24h of job run; accepting “Now” switches plan immediately; accepting “At renewal” schedules change with effective date set.

Story: No surprise billing occurs on OP changes.

AC: Plan changes never adjust past invoices; future charges update only at the effective date; dunning follows Stripe schedule.

Story: Downgrade offers appear after sustained drop.

AC: After 3 consecutive monthly checks below a lower tier, a downgrade suggestion appears; on acceptance, change is queued for renewal.

14.14 Risks & mitigations

Seasonality false positives → Grace band + two-month confirmation; support override.

Under-reported POS removals → Encourage Sales ingest setup in onboarding; surface “Removals not posted” anomaly in Compliance center.

Low ACV vs onboarding effort → Promote setup packages; self-serve CSV mappers.

14.15 Copy blocks (ready-to-use)

Pricing page hero:

“Unlimited users on every plan. Priced by annual BBL—simple, fair, and paperwork-free.”

FAQ: How do you calculate production?

“We annualize the last 90 days of your packaged volume to estimate annual BBL. There’s a ±10% grace band, and we confirm changes across two months to avoid seasonal spikes. We’ll notify you and wait until your next renewal unless you choose to switch sooner.”

OP upgrade banner:

“You’re tracking ~{op_bbl} BBL/yr, above the {plan} band. We’ll move you to {next_plan} ({price}) on {renewal_date}. Accept now or Talk to us.”

15) Rollout & timeline (CHANGED)

Phase 0 (2–4 wks) Discovery & design: TTB/Excise mapping; POs; Yeast; Transfers; Sales ingest flows.
Phase 1 (8–10 wks) Build core: Recipes, Inventory, POs, Batches, Tanks, Yeast, Packaging (with blends/lot codes), Dashboard, Imports/Exports, Audit.
Phase 1.5 (4 wks) Compliance: BROP + Excise; Transfers in bond; POS ingest; QBO CSV; alerts.
Closed Beta (4–6 wks) 8–12 breweries; weekly releases; activation + compliance success reviews.
GA Docs, pricing page, setup packages, webinars.
Post‑GA (quarterly) QBO one‑way post; Sales Orders; SSO; API keys/webhooks.

16) Go‑to‑market & onboarding (CHANGED)

ICP: U.S. micro/craft, <5k BBL/year, 3–20 staff, self‑distribution optional.

Channels: State guilds; forums; supplier co‑marketing; “From spreadsheets to BROP + excise in 30 days” webinars.

Lead magnet: Free BROP + excise calculator; import wizard.

Onboarding motion: CS‑assisted first 50 logos; then in‑app + office hours.

Migration: CSV templates + competitor mapping presets; white‑glove import; TTB rehearsal.

17) Risks & mitigations (CHANGED)
Risk	Impact	Mitigation
Under‑scoped compliance edge cases	Filing errors	Model owner of record, in‑bond transfers, snapshots; pilot advisors
Low ACV vs high onboarding effort	Unit economics	Setup packages; templatized imports; office hours at scale
POS gap breaks removals	TTB mismatch	Ship sales ingest MVP; expand connectors later
Yeast not tracked	Quality/cost	MVP yeast batches; viability later
Keg deposits ignored	Liability drift	Minimal ledger + QBO export
18) Open questions & assumptions (updated)

Sales Orders in MVP? → Still Should‑have (self‑distribution heavy customers may push this up).

COGS method defaults? → Default Actual lots for COGS; Moving average optional; Latest cost for inventory valuation.

Offline scope? → Outbox for brew/ferm/pack logs + POS ingest; not full offline.

Labels/barcodes? → Basic lot/date labels in MVP; barcode printing later.

Contract brand access? → Read‑only portal scoped to their batches/lot snapshots.

19) Appendix A — TTB mapping (expanded, high‑level)

BROP (5130.9 monthly / 5130.26 quarterly): Production, removals, returns, destroyed/testing; reconcile opening/closing.

Excise (5000.24): Taxable removals staged from sales/shipments; worksheet export for Pay.gov.

Transfers in bond: Distinguish same vs different ownership; bulk vs packaged; doc numbers and counterpart identifiers stored.

Contract/Alternating: Owner entity on batch drives lines and signatures.

Recordkeeping: Retain required records ≥ 3 years; snapshots/time‑stamped exports.

Reconciliation: Opening + Production − Losses − Removals + Returns = Closing (tolerances configurable).

20) Appendix B — CSV templates (expanded)

Items: name,type,uom,reorderLevel,vendorName,conversionRulesJSON
ItemLots: itemName,lotCode,qty,uom,unitCost,expiry,locationName
Recipes: recipeName,version,style,targetVolume,overheadPct + rows: ingredientName,quantity,uom,phase
Tanks: name,type,capacity
Vendors: name,email,phone,terms
POs: vendorName,orderDate,dueDate,itemName,qty,uom,expectedUnitCost,locationName
POS Sales: date,skuCode,qty,destinationType(taproom|distributor),docRef
Transfers in bond: date,fromBrewer,toBrewer,ownershipSame(bool),containerType,qty,uom,notes

21) Appendix C — Sample brew sheet (kept)

Batch ID; Recipe; Target volume; Efficiency %; Mash schedule; Boil/Whirlpool additions; Cooling & pitch temp; Yeast strain/lot; OG target/actual; Notes.

22) Appendix D — Permissions detail (expansion kept/updated)

Brewer vs Brewer+ (cost visibility).

Inventory (with/without adjustments).

Accounting (TTB only vs full reports).

Location‑scoped access (post‑MVP).

Contract Brand viewer (read‑only snapshots relevant to their batches).

23) Appendix E — Telemetry schema (kept + new fields)

event_name, role, device, workspace, entity_type, entity_id, duration_ms, offline_queued (bool), cost_method, form_type (BROP/Excise).

24) Why sensors are out‑of‑scope (kept, clarified)

Today’s pain is process, purchasing, and compliance. We keep an Integration Service ready for later.