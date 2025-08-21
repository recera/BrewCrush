# BrewCrush Deployment Guide

## Overview
This guide covers deploying BrewCrush to production with Next.js on Vercel and Supabase.

## Prerequisites
- Vercel account
- Supabase account (production project)
- Stripe account
- Domain name (optional)

## Database Setup

### 1. Supabase Project Creation
1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Save your project credentials:
   - Project URL
   - Anon Key (public)
   - Service Role Key (keep secret!)

### 2. Database Migrations

**IMPORTANT**: All migrations must be applied in order. The migrations handle:
- Core schema setup (workspaces, users, inventory, production)
- Billing system (plans, account billing, observed production)
- Compliance engine (BROP, excise, transfers)
- Scheduled jobs (cron functions)

#### Apply Migrations via Supabase CLI:
```bash
# Link to your production project
supabase link --project-ref your-project-ref

# Push all migrations
supabase db push
```

#### Manual Migration Order (if needed):
1. `00001_initial_schema.sql` through `00020_phase8_report_generation.sql`
2. `00021_phase9_notifications.sql`
3. `00022_phase10_billing_system.sql`
4. `00023_phase10_billing_cron_jobs.sql` (see notes below)
5. `00024_phase10_signup_billing_functions.sql` ⚠️ **CRITICAL for signup**
6. `00025_phase10_notification_queue.sql`

### 3. Cron Jobs Setup

The `00023_phase10_billing_cron_jobs.sql` migration creates cron functions but may not schedule them automatically due to permissions. 

**For Production:**
1. Enable pg_cron extension in Supabase dashboard (Database → Extensions)
2. The migration creates these functions that can be called:
   - `calculate_observed_production_for_all()` - Run weekly
   - `check_plan_suggestions()` - Run daily
   - `check_payment_failures()` - Run daily
   - `send_trial_reminders()` - Run daily
   - `cleanup_old_snapshots()` - Run weekly

3. Schedule via Supabase Edge Functions or external cron service

### 4. Required Database Functions

The following RPC functions MUST exist for the app to work:
- `create_workspace_with_billing` - Called during signup/onboarding
- `join_workspace_with_invite` - For team invites
- `activate_workspace_billing` - Called by Stripe webhook
- `get_workspace_billing_status` - Used in billing pages

Verify they exist:
```sql
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_type = 'FUNCTION' 
  AND routine_schema = 'public'
  AND routine_name LIKE '%billing%';
```

## Environment Variables

### Local Development (.env.local)
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-local-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-local-service-key

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3002
```

### Production (Vercel Environment Variables)
```env
# Supabase (from your Supabase project)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-production-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-production-service-key

# Stripe (from Stripe dashboard)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# App
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

## Deployment Steps

### 1. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod

# Or connect GitHub repo for automatic deployments
```

### 2. Configure Vercel
1. Add all environment variables in Vercel dashboard
2. Set up domain (optional)
3. Configure build settings:
   - Build Command: `pnpm build`
   - Output Directory: `apps/web/.next`
   - Install Command: `pnpm install`

### 3. Stripe Webhook Setup
1. Go to Stripe Dashboard → Webhooks
2. Add endpoint: `https://your-domain.com/api/stripe/webhook`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy webhook secret to Vercel env vars

### 4. Supabase Configuration
1. Set up Auth providers (if using social auth)
2. Configure Auth URLs:
   - Site URL: `https://your-domain.com`
   - Redirect URLs: `https://your-domain.com/auth/callback`
3. Enable Row Level Security (should be done by migrations)
4. Set up Storage buckets (if not created by migrations)

## Post-Deployment Verification

### 1. Test Critical Flows
- [ ] User signup creates account
- [ ] Workspace creation works (calls `create_workspace_with_billing`)
- [ ] Login/logout works
- [ ] Basic navigation works

### 2. Verify Database
```sql
-- Check billing plans exist
SELECT * FROM billing_plans;

-- Check functions exist
SELECT routine_name FROM information_schema.routines 
WHERE routine_schema = 'public' AND routine_type = 'FUNCTION';

-- Check if RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';
```

### 3. Monitor for Errors
- Check Vercel Functions logs
- Check Supabase logs
- Monitor browser console for errors

## Troubleshooting

### "Could not find function" Error
This means the database migrations haven't been applied properly. Re-run migrations in order.

### Cron Jobs Not Running
- Check if pg_cron is enabled in Supabase
- Consider using Supabase Edge Functions with scheduled triggers instead
- Or use external cron service to call the functions

### Stripe Webhooks Failing
- Verify webhook secret is correct
- Check endpoint URL is accessible
- Review Stripe webhook logs for error details

### RLS Errors
- Ensure user is authenticated
- Check RLS policies are correctly set up
- Verify JWT claims include workspace_id

## Maintenance

### Regular Tasks
- Monitor Observed Production calculations
- Check for stuck cron jobs
- Review error_logs table
- Monitor billing status and trial expirations

### Backup Strategy
- Supabase provides automatic daily backups
- Consider additional backup for critical periods (month-end for BROP)
- Export compliance snapshots regularly

## Support

For deployment issues:
1. Check Supabase logs (Database → Logs)
2. Check Vercel function logs
3. Review error_logs table in database
4. Check browser developer console

## Notes

- The app uses PWA features - ensure service worker is properly cached
- Offline functionality requires IndexedDB support
- Mobile views are critical for brewery floor usage
- Compliance features (BROP/Excise) are US-specific