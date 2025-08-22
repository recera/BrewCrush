# Week 2 Implementation Plan - Enhanced UX & Advanced Features

## Overview
Building on Week 1's solid foundation, Week 2 focuses on UX polish and advanced production features to make BrewCrush truly production-ready for daily brewery operations.

---

## Current State Assessment

### ✅ Week 1 Accomplishments
- Unified production architecture under `/production`
- Comprehensive batch lifecycle management
- Full recipe scaling with ingredient tracking
- Real-time cost tracking and stock validation
- Database infrastructure with views and functions

### 🎯 Week 2 Focus Areas
1. **Mobile-First Production Tools** - QuickLog for fermentation readings
2. **Visual Planning** - Drag-and-drop production calendar
3. **Smart Automation** - Prompts and alerts for critical actions
4. **Quality Control** - QA spec overlays on charts
5. **Operational Efficiency** - Batch comparison, cloning, exports

---

## High Priority Tasks (Must Complete)

### 1. Production Calendar with Drag-and-Drop Scheduling
**Goal:** Visual tank planning with conflict detection and resource management

**Technical Approach:**
- Use `@dnd-kit/sortable` for accessible drag-and-drop
- Tank lanes visualization (swimlanes pattern)
- Real-time conflict detection (CIP status, yeast availability)
- Timeline view: day/week/month toggles
- Color coding: batch status, urgency indicators

**Components to Build:**
- `/app/production/calendar/page.tsx` - Main calendar view
- `/components/production/CalendarView.tsx` - Calendar component
- `/components/production/BatchCard.tsx` - Draggable batch cards
- `/components/production/TankLane.tsx` - Tank swimlanes

**Database Updates:**
- Add `planned_start_date` and `planned_end_date` to batches table
- Create `tank_schedules` view for availability calculations
- Add conflict detection function `check_tank_availability()`

**Acceptance Criteria:**
- Batches can be dragged between tanks
- Conflicts prevent invalid drops with visual feedback
- Changes persist immediately
- Mobile touch support works

### 2. QuickLog Component for Mobile Fermentation
**Goal:** One-handed fermentation logging optimized for brewery floor

**Technical Approach:**
- Large touch targets (minimum 48px)
- Numeric keypad input
- Offline-first with IndexedDB queue
- Sparkline visualization of recent readings
- Voice input support (stretch goal)

**Components to Build:**
- `/components/production/QuickLog.tsx` - Main component
- `/components/production/QuickLogButton.tsx` - FAB trigger
- `/components/production/NumericKeypad.tsx` - Custom keypad
- `/components/production/ReadingSparkline.tsx` - Mini chart

**Features:**
- SG, temperature, pH inputs
- Photo attachment option
- Previous reading display
- Offline queue indicator
- Haptic feedback on save

**Mobile Optimizations:**
- PWA manifest updates for "Add to Home Screen"
- Service worker caching for offline use
- IndexedDB for queued readings
- Background sync when online

### 3. Fermentation Chart Overlays with QA Specs
**Goal:** Visual quality control with target ranges and anomaly detection

**Technical Approach:**
- Recharts overlays for target bands
- Color-coded zones (optimal, warning, critical)
- Annotation system for events
- Predictive trend lines

**Updates to Make:**
- Enhance existing fermentation chart in batch detail
- Add QA spec ranges from recipe
- Implement anomaly detection algorithm
- Add annotation capabilities

**Visual Elements:**
- Shaded target zones
- Dotted lines for min/max specs
- Color gradients for temperature/gravity
- Event markers (dry hop, temperature changes)

**Database Updates:**
- Add `qa_specs` JSONB to recipe_versions
- Create `fermentation_anomalies` table
- Add `detect_fermentation_anomalies()` function

### 4. Automated Prompts System
**Goal:** Proactive notifications for time-sensitive brewery actions

**Technical Approach:**
- Rule-based prompt engine
- Postgres triggers for event detection
- In-app notifications + email digests
- Snooze and acknowledge capabilities

**Prompt Types:**
- "Ready to crash" (based on SG stability)
- "Harvest yeast today" (generation tracking)
- "CIP required" (after tank empty)
- "Take gravity reading" (schedule-based)
- "Tank at capacity" warnings

**Components to Build:**
- `/components/production/PromptBanner.tsx` - In-app prompts
- `/components/production/PromptsList.tsx` - Prompt management
- Database functions for prompt generation
- Edge function for email digests

**Database Updates:**
- Create `production_prompts` table
- Add `prompt_rules` configuration table
- Create `generate_daily_prompts()` function
- Add pg_cron job for prompt generation

---

## Medium Priority Tasks (Should Complete)

### 5. Batch Comparison View
**Goal:** Side-by-side analysis of batch performance

**Features:**
- Compare 2-4 batches simultaneously
- Metrics: yield, efficiency, timeline, costs
- Chart overlays for fermentation curves
- Export comparison report

**Implementation:**
- `/app/production/batches/compare/page.tsx`
- Reusable comparison table component
- PDF export via Edge Function

### 6. Batch Cloning
**Goal:** Quick replication of successful batches

**Features:**
- Clone with modifications
- Preserve recipe link
- Copy fermentation schedule
- Adjust volumes/dates

**Implementation:**
- Add "Clone" button to batch detail
- Modal for modifications
- Server-side RPC function

### 7. Batch Data Export
**Goal:** Multiple export formats for reporting

**Formats:**
- CSV (fermentation data, costs)
- PDF (batch summary sheet)
- JSON (full batch data)
- Excel (formatted report)

**Implementation:**
- Export menu in batch detail
- Edge Functions for generation
- Template system for PDFs

### 8. Printable Batch Sheets
**Goal:** Physical documentation for brewery floor

**Contents:**
- Recipe summary
- Ingredient checklist
- Target specifications
- Fermentation log template
- QR code for mobile access

**Implementation:**
- Print CSS styles
- PDF generation via Edge Function
- A4 and Letter formats

---

## Low Priority Tasks (Nice to Have)

### 9. Batch Photo Uploads
- Attach photos to fermentation readings
- Gallery view in batch detail
- Supabase Storage integration

### 10. Batch Rating System
- 5-star rating
- Tasting notes
- Success metrics tracking

### 11. Batch Templates
- Save successful batches as templates
- Quick-start new batches
- Seasonal recipe management

### 12. Predictive Analytics
- Fermentation curve predictions
- Anomaly detection ML model
- Yield forecasting

---

## Technical Considerations

### Performance
- Virtualize calendar for many batches
- Lazy load chart data
- Optimize drag-and-drop for mobile
- Cache prompt calculations

### Accessibility
- Keyboard navigation for calendar
- Screen reader announcements for drops
- High contrast mode support
- Alternative to drag-and-drop

### Testing Strategy
- E2E tests for calendar interactions
- Offline mode testing for QuickLog
- Performance testing with 100+ batches
- Mobile device testing matrix

### Database Migrations
```sql
-- 00029_week2_scheduling.sql
- Add planned dates to batches
- Create tank_schedules view
- Add conflict detection functions

-- 00030_week2_prompts.sql
- Create prompts tables
- Add prompt generation functions
- Setup pg_cron jobs

-- 00031_week2_qa_specs.sql
- Add QA specs to recipes
- Create anomaly detection
- Add fermentation targets
```

---

## Implementation Schedule

### Day 1: Production Calendar
- Morning: Setup drag-and-drop infrastructure
- Afternoon: Build calendar components
- Evening: Implement conflict detection

### Day 2: QuickLog & Mobile
- Morning: Create QuickLog component
- Afternoon: Implement offline queue
- Evening: Mobile optimizations

### Day 3: QA & Automation
- Morning: Add chart overlays
- Afternoon: Build prompts system
- Evening: Testing and refinement

### Day 4: Additional Features
- Morning: Batch comparison
- Afternoon: Cloning and exports
- Evening: Documentation

---

## Success Metrics

### User Experience
- QuickLog entry < 15 seconds
- Calendar drag response < 100ms
- Prompt generation < 1 second
- Mobile Lighthouse score > 90

### Business Value
- 50% reduction in missed readings
- 75% of tanks scheduled visually
- 90% prompt acknowledgment rate
- Zero scheduling conflicts

### Code Quality
- 100% TypeScript coverage
- Zero accessibility violations
- All features offline-capable
- Comprehensive error handling

---

## Risk Mitigation

### Technical Risks
- **Drag-and-drop performance:** Use virtual scrolling
- **Offline conflicts:** Implement smart conflict resolution
- **Prompt accuracy:** Allow user configuration and overrides

### User Adoption
- **Training needs:** In-app tutorials for new features
- **Mobile resistance:** Ensure desktop fallbacks exist
- **Alert fatigue:** Smart prompt throttling

---

## Definition of Done

Each feature is complete when:
- ✅ Fully functional with no placeholders
- ✅ Mobile and desktop responsive
- ✅ Offline capable where applicable
- ✅ Accessible (WCAG 2.1 AA)
- ✅ Error handling implemented
- ✅ Database migrations created
- ✅ TypeScript types complete
- ✅ Tested on real devices
- ✅ Documentation updated

---

## Next Steps

1. Begin with production calendar (highest impact)
2. Implement QuickLog in parallel
3. Layer in QA overlays and prompts
4. Add batch operations as time permits

---

*Plan created: 2025-08-21*
*Estimated completion: 3-4 days of focused development*