BrewCrush — UI Design Report (Blueprint)

UI SHOULD BE CLEAN AND PROFESSIONAL

Version: v1.1 (Aug 2025) • Status: Draft

1) Principles & guardrails (kept, with adds)

Brewer‑first, desk‑second; mobile/tablet flows must be effortless and offline‑safe.

Clarity over density; progressive disclosure.

One‑hand operation; large tap targets (≥44px); numeric keypad for measurements.

Fast feedback: autosave, optimistic UI, inline validation.

Trust via transparency: lot overrides show COGS deltas; visible audit trails. NEW

Accessible by default (WCAG 2.1 AA).

Reliability: PWA + offline outbox (explicit Queued items tray, retry/backoff log). NEW

Unlimited users; role‑appropriate UI (Contract Brand read‑only views). NEW

2) Navigation & IA (updated)

Desktop/top bar: Workspace switcher • global search/command (⌘K/CTRL‑K) • bell • help • user menu.
Primary nav: Dashboard • Purchasing • Production • Inventory • Recipes • Packaging • Reports • Compliance • Settings.
Mobile/tabs: Home • Production • Inventory • Reports • More (Purchasing/Compliance inside).
Breadcrumbs: e.g., Production / Batches / IPA‑042.
Context actions: Right rail “Actions” panel or sticky footer.

3) Breakpoints & layout (kept)

Mobile ≤640px; Tablet 641–1024px; Desktop ≥1024px; Brew Day Mode increases spacing and font size.

4) Global components & patterns (kept + adds)

Buttons, inputs (units suffix), chips/badges, tables (virtualized), cards, toasts, banners.

Slide‑overs for quick logs; modals for confirmations/wizards.

Command Palette for search + actions.

Empty states with safe primary action + import links.

Skeletons for >250ms loads.

Outbox tray (NEW): shows queued actions with retry/backoff details.

COGS method badge (NEW): visible on cost reports and batch cost cards.

5) Role‑aware home (updated)

Brewer/Cellar

Today’s Brew card → Start Brew Day.

Tank snapshot (SG/temp, days, CIP, yeast prompts).

Tasks today: crash, transfer, harvest yeast.

Critical low stock: packaging/hops for next 7 days.

Owner/Accounting/Compliance

Production summary; COGS/margin; inventory value.

BROP & Excise status with due date.

Open POs; supplier price spikes; deposit ledger.

6) Screen inventory (index, expanded)
ID	Module	Screen	Users	Purpose
A1	Auth	Sign in / invite / create workspace	All	Access & onboarding
B1	Dashboard	Role‑aware home	All	Status & quick actions
C1	Recipes	Recipe list	Brewer/Admin	Manage recipes
C2	Recipes	Recipe detail (Overview/Ingredients/Steps/Costing/Specs/Versions)	Brewer/Admin	Edit & cost; QA specs
D1	Production	Batches list	Brewer/Admin	Track batches
D2	Production	Schedule (calendar)	Brewer/Admin	Plan brews/tanks
D3	Production	Batch detail	Brewer	Logs & costs
D4	Production	Brew Day mode	Brewer	Checklist + actuals
E1	Tanks	Tank board	Brewer/Cellar	Live fermentation & logs
E2	Tanks	Tank detail	Brewer/Cellar	History, readings, maintenance
Y1	Yeast	Yeast dashboard	Brewer/Admin	Pitches, harvests, generations NEW
Y2	Yeast	Yeast batch detail	Brewer/Admin	Lifecycle & links NEW
P1	Purchasing	POs list	Inventory/Admin	Manage POs NEW
P2	Purchasing	PO create/edit	Inventory/Admin	Create/approve NEW
P3	Purchasing	Receive against PO	Inventory	Receiving NEW
F1	Packaging	Runs list	Brewer/Inventory	Track runs
F2	Packaging	Packaging wizard (blends, codes)	Brewer/Inventory	Convert to SKUs
G1	Inventory	Items catalog	Inventory/Admin	Stock overview
G2	Inventory	Item detail + lots	Inventory	Costs, lots, price history CHANGED
G3	Inventory	Receiving session	Inventory	Receive stock
G4	Inventory	Adjust/transfer	Inventory/Admin	Moves
G5	Inventory	Cycle count	Inventory	Audits
S1	Sales ingest	Upload & map	Accounting	Post removals NEW
H1	Reports	Reports hub	Owner/Accounting	On‑hand, COGS, recall, PO aging CHANGED
I1	Compliance	TTB center (BROP)	Accounting/Admin	Generate & reconcile
I2	Compliance	Excise worksheet	Accounting/Admin	Prepare return NEW
I3	Compliance	Transfers in bond	Accounting/Admin	Create & print docs NEW
J1	Settings	Users & roles	Admin	Access control
J2	Settings	Locations/Tanks	Admin	Configure sites & vessels
J3	Settings	Integrations	Admin	QBO, API keys
K1	Import/Export	Import wizard	Admin	CSV mapping/validation
7) Auth & onboarding (kept + expanded)

“No credit card required for trial.”

First‑run checklist now includes PO, Yeast, BROP & Excise rehearsal.

“Resume setup” card persists until completion.

“Prefer we import your spreadsheet?” link → setup packages.

8) Recipes (kept + specs)

C1: Search, filter, sort.
C2: Tabs include Specs; Costs show COGS method badge; “Use for batch”.

9) Production — Batches, Schedule, Brew Day (kept + polish)

D2: Calendar shows CIP and yeast availability badges; clash warnings.

D4: Brew Day timers persist; offline banner; COGS delta shown on lot override.

10) Tanks & fermentation (kept + yeast & CIP)

E1 tank card: CIP status; yeast prompts; one‑tap “Harvest”.

E2 detail: add Yeast tab: pitch/harvest history.

11) Yeast (NEW)

Y1 dashboard: strain list; active pitches; generations; alerts if near max gen.

Y2 detail: pitch/harvest timeline; link to batches; notes/photos.

12) Purchasing (NEW)

P1 list with status chips; filters; vendor.

P2 create/approve; vendor catalog hints; price history inline.

P3 receive: scan/add lines; lot/expiry/cost; partials; variance banner.

13) Packaging (kept + blends/codes)

F2 wizard: select multiple source batches; allocation table; code template preview; label PDFs.

14) Inventory (kept + price history)

G2 Item detail shows supplier price trend sparkline; vendor list.

15) Sales ingest (NEW)

S1 wizard: upload CSV → mapping UI → validation preview → post.

Error handling: per‑row errors; downloadable error CSV.

16) Reports (kept + recall & purchasing)

Recall drill: finished lot → upstream ingredient lots & downstream shipments; export.

PO aging; supplier price trend; keg deposit ledger; saved views.

17) Compliance (expanded)

I1 BROP: form type & due date shown; reconciliation grid; anomalies; snapshot.

I2 Excise: worksheet with taxable removals; summary; export for Pay.gov.

I3 Transfers: wizard + printable form; posting; appear in BROP.

18) Microcopy, errors & states (kept + targeted)

Lot override: “You selected Lot ABC over FIFO. COGS +$12.40 for this batch.”

Transfers: “This movement is in bond; no excise due at this step.”

Excise: “We’ll prepare your worksheet—submit via Pay.gov.”

Offline: “You’re offline. 3 entries queued. We’ll sync automatically.”

19) Accessibility & input ergonomics (kept)

Visible focus, ARIA live regions, reduced motion.

Numeric inputmode for SG/Temp/Counts; drag/drop alternatives provided.

20) Data viz patterns (kept)

Ferm chart; Production trend; COGS pie; add Supplier price trend line chart.

21) Scanning & camera flows (kept)

Receiving, cycle counts, packaging labels; vibrate on read; manual fallback.

22) Print & export (kept + codes)

Brew sheet print; packaging labels include lot/date codes; reports print cleanly.

23) Theming & tokens (kept)

Neutral‑first palette; colorblind‑safe; 4‑pt grid; Brew Day Mode sizing.

24) Analytics (UI instrumentation, expanded)

Add po_receive_post, yeast_harvest, excise_generate, inbond_doc_print, sales_ingest_import_complete, recall_drill_open.

25) QA checklists (per module, adds)

Purchasing

Create/approve; partial receipts; price history updates; variance banner on receive.

Yeast

Pitch/harvest flows; generation increments; prompts; offline logging.

Compliance

BROP reconciliation correct; Excise worksheet totals match removals; snapshots stored.

Sales ingest

Mapping presets; failed rows exported; removals posted correctly.

Transfers in bond

Required counterpart fields; document print; inventory moves flagged inBond.

26) Future‑ready hooks (kept)

Orders/CRM placeholders; Keg tracking container IDs; Sensors tab flag.

27) Prototyping plan (updated)

Round 1 wires: add Purchasing, Yeast, Excise, In‑bond, Sales ingest.
Round 2 clickable: mobile Brew Day, packaging blends/codes, PO receiving, excise worksheet, transfer wizard.
Usability: 8–10 brewers: time/logs; PO receive <2m/5 lines; excise worksheet <5m with no errors.

28) Deliverables summary (what to build — MVP v1.1)

Global shell; role‑aware dashboard; command palette; notifications; Outbox tray.

Recipes (versions, costing, specs; “Use for batch”).

Production (batches, calendar, batch detail, Brew Day).

Tanks (board, quick log, detail, CIP status).

Yeast (dashboard + detail).

Inventory (catalog; item detail/lots; receiving; adjust/transfer; cycle count; price history; keg deposit ledger).

Purchasing (POs create/approve/receive; supplier catalogs).

Packaging (runs + wizard; blends; codes).

Reports hub (on‑hand; batch summary; production; recall drill; PO aging).

Compliance (BROP + Excise worksheet; Transfers in bond; contract/alt attribution).

Settings (users/roles; locations/tanks; integrations; prefs).

Import/export wizard (incl. POS/Sales ingest).

PWA/offline scaffolding (outbox, banners, sync).

Accessibility & QA baked in.

Changelog (from v1.0 → v1.1)

Promoted to MVP: POs; Yeast management; Excise worksheet; Transfers in bond; POS/Sales ingest.

Expanded packaging: Blends; date/lot code templates.

COGS clarity: Actual lots + Moving average; method badges.

Compliance depth: Contract/alternating proprietorship attribution; snapshots; due‑date UI.

Reports: Recall drill; PO aging; supplier price trend; deposit ledger.

Data model: YeastBatch; InBondTransfer; Removal; KegDepositEntry; PackagingRun supports multiple source batches.

IA: Added Purchasing; split Compliance into BROP, Excise, Transfers.

Onboarding: TTB rehearsal; setup packages.