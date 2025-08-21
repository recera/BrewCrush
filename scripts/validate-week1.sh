#!/bin/bash

# Week 1 Implementation Validation Script
# This script verifies all Week 1 changes are properly integrated

echo "==================================="
echo "Week 1 Implementation Validation"
echo "==================================="
echo ""

# Check that old routes are removed
echo "1. Checking old routes removed..."
if [ ! -d "apps/web/src/app/batches" ]; then
    echo "✅ /batches directory removed"
else
    echo "❌ /batches directory still exists"
fi

if [ ! -d "apps/web/src/app/tanks" ]; then
    echo "✅ /tanks directory removed"
else
    echo "❌ /tanks directory still exists"
fi

if [ ! -d "apps/web/src/app/yeast" ]; then
    echo "✅ /yeast directory removed"
else
    echo "❌ /yeast directory still exists"
fi

echo ""
echo "2. Checking new production structure..."
if [ -f "apps/web/src/app/production/page.tsx" ]; then
    echo "✅ Production hub page exists"
else
    echo "❌ Production hub page missing"
fi

if [ -f "apps/web/src/app/production/batches/page.tsx" ]; then
    echo "✅ Batches page exists under production"
else
    echo "❌ Batches page missing under production"
fi

if [ -f "apps/web/src/app/production/batches/[id]/page.tsx" ]; then
    echo "✅ Batch detail page exists"
else
    echo "❌ Batch detail page missing"
fi

if [ -f "apps/web/src/app/production/tanks/page.tsx" ]; then
    echo "✅ Tanks page exists under production"
else
    echo "❌ Tanks page missing under production"
fi

if [ -f "apps/web/src/app/production/yeast/page.tsx" ]; then
    echo "✅ Yeast page exists under production"
else
    echo "❌ Yeast page missing under production"
fi

echo ""
echo "3. Checking database migrations..."
if [ -f "supabase/migrations/00026_production_hub_functions.sql" ]; then
    echo "✅ Production hub functions migration exists"
else
    echo "❌ Production hub functions migration missing"
fi

if [ -f "supabase/migrations/00027_batch_detail_views.sql" ]; then
    echo "✅ Batch detail views migration exists"
else
    echo "❌ Batch detail views migration missing"
fi

if [ -f "supabase/migrations/00028_batch_recipe_scaling.sql" ]; then
    echo "✅ Batch recipe scaling migration exists"
else
    echo "❌ Batch recipe scaling migration missing"
fi

echo ""
echo "4. Checking navigation updates..."
if grep -q "/production/batches" apps/web/src/components/dashboard/shell.tsx; then
    echo "✅ Shell navigation updated to use /production/batches"
else
    echo "❌ Shell navigation not updated"
fi

if grep -q "/dashboard/compliance" apps/web/src/components/dashboard/shell.tsx; then
    echo "✅ Compliance route fixed in shell"
else
    echo "❌ Compliance route not fixed"
fi

echo ""
echo "5. Checking recipe scaling implementation..."
if grep -q "preview_recipe_scaling" apps/web/src/components/recipes/UseForBatchDialog.tsx; then
    echo "✅ Recipe scaling preview integrated"
else
    echo "❌ Recipe scaling preview not integrated"
fi

if grep -q "hasStockIssues" apps/web/src/components/recipes/UseForBatchDialog.tsx; then
    echo "✅ Stock validation integrated"
else
    echo "❌ Stock validation not integrated"
fi

echo ""
echo "6. Checking for required imports..."
echo "Checking production hub imports..."
if grep -q "@tanstack/react-query" apps/web/src/app/production/page.tsx && \
   grep -q "createClient" apps/web/src/app/production/page.tsx && \
   grep -q "useUserRole" apps/web/src/app/production/page.tsx; then
    echo "✅ Production hub has required imports"
else
    echo "❌ Production hub missing imports"
fi

echo ""
echo "==================================="
echo "Validation Complete"
echo "==================================="