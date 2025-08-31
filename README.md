# BrewCrush

The easiest way for small breweries to plan, brew, package, track, and file—from grain to TTB.

## Overview

BrewCrush is a comprehensive brewery management system designed to replace spreadsheets for small and micro breweries. It provides production planning, inventory management, purchasing, compliance reporting (BROP & excise), and robust offline support.

## Tech Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL, Auth, Storage, Edge Functions)
- **Payments**: Stripe
- **Deployment**: Vercel (Frontend), Supabase (Backend)
- **Testing**: Vitest, Playwright, pgTAP

## Key Features

- **Mobile-first** with offline support (PWA)
- **Recipe Management** with versioning and cost rollup
- **Production Planning** from grain to glass
- **Inventory Tracking** with lot management
- **Purchase Orders** with supplier price history  
- **Packaging** with blends and lot/date codes
- **TTB Compliance** (BROP generation & excise prep)
- **Multi-user** with role-based access (unlimited users)
- **Real-time sync** with offline queue

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 8+
- Supabase CLI
- PostgreSQL 15+

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/brewcrush.git
cd brewcrush
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
# Edit .env.local with your Supabase and Stripe credentials
```

4. Set up Supabase:
```bash
# Start local Supabase
supabase start

# Run migrations
supabase db push

# Seed demo data
supabase db seed
```

5. Start development server:
```bash
pnpm dev
```

Visit `http://localhost:3000` to see the application.

## Project Structure

```
brewcrush/
├── apps/
│   └── web/                 # Next.js application
│       ├── src/
│       │   ├── app/         # App Router pages
│       │   ├── components/  # React components
│       │   ├── lib/         # Utilities and configurations
│       │   ├── hooks/       # Custom React hooks
│       │   └── types/       # TypeScript types
│       └── e2e/            # Playwright E2E tests
├── packages/
│   ├── ui/                 # Shared UI components
│   └── zod-schemas/        # Shared validation schemas
├── supabase/
│   ├── migrations/         # Database migrations
│   └── functions/          # Edge Functions
└── turbo.json             # Turborepo configuration
```

## Development

### Commands

```bash
# Development
pnpm dev                    # Start dev server
pnpm build                  # Build for production
pnpm start                  # Start production server

# Testing
pnpm test                   # Run all tests
pnpm test:unit             # Run unit tests
pnpm test:e2e              # Run E2E tests

# Code Quality
pnpm lint                   # Run ESLint
pnpm format                 # Format with Prettier
pnpm typecheck             # TypeScript type checking

# Database
pnpm db:push               # Push migrations
pnpm db:reset              # Reset database
pnpm db:seed               # Seed demo data
```

### Testing

- **Unit Tests**: Vitest with React Testing Library
- **E2E Tests**: Playwright for browser automation
- **Database Tests**: pgTAP for SQL testing (planned)

### CI/CD

GitHub Actions workflows:
- **CI**: Runs on all PRs (lint, typecheck, tests)
- **Deploy**: Deploys to Vercel and Supabase on main branch

## Architecture

### Database Schema

- Multi-tenant with Row Level Security (RLS)
- Workspace-based isolation
- Immutable audit logs with hash chain
- Partitioned tables for high-volume data (fermentation readings)

### Offline Support

- Progressive Web App (PWA) with service worker
- IndexedDB for offline queue
- Idempotent sync with conflict resolution
- Visible outbox with retry/backoff

### Security

- Row Level Security (RLS) for all tables
- Role-based access control (RBAC)
- Audit logging for all mutations
- Encrypted at rest (AES-256)

## Documentation

- [Product Requirements (PRD)](./PRD.md)
- [UI Design Blueprint](./UI.md) 
- [Technical Architecture](./TECHNICAL.md)
- [Build Plan](./BUILD_PLAN.md)

## Contributing

Please read our contributing guidelines before submitting PRs.

## License

Proprietary - All rights reserved

## Support

For support, email support@brewcrush.com or open an issue.