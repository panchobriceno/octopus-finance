# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start development server (Express + Vite on port 5000)
npm run build        # Build for production (Vite + post-process dist)
npm run check        # TypeScript type checking
npm run db:push      # Push Drizzle schema changes (see note below)
```

There is no test runner configured.

## Architecture

**Full-stack TypeScript monorepo** — single `package.json` at root manages both client and server.

### Data Layer

The app has two data layers; **Firebase Firestore is the primary one**:

- **`client/src/lib/firestore.ts`** — All CRUD operations for every entity (transactions, categories, items, budgets, clients, clientPayments, accounts, openingBalances, preferences). The client calls this directly.
- **`server/routes.ts`** — Express REST API (`/api/...`) backed by in-memory storage (`server/storage.ts`). This is a secondary/legacy layer; the client does not call it in normal operation.
- **`shared/schema.ts`** — Zod schemas and TypeScript types shared between client and server. `drizzle.config.ts` exists but Drizzle/PostgreSQL is not actively used — Firebase is the real database.

### Client

- **Entry:** `client/src/main.tsx` → `App.tsx` → hash-based routing via `wouter`
- **State:** React Query (`@tanstack/react-query`) for all server state; local `useState` for UI state. No Redux or Zustand.
- **Data flow:** Page components call React Query hooks (`client/src/lib/hooks.ts`) → hooks call Firestore functions → on mutation success, `queryClient.invalidateQueries(...)` triggers refetch.
- **Routing:** `wouter` with hash navigation. 12 page components under `client/src/pages/`.
- **UI:** Radix UI + shadcn/ui components (`client/src/components/ui/`), Tailwind CSS, Recharts for charts.

### Business Logic

- **`client/src/lib/finance.ts`** — Core calculations: workspace filtering, installment splitting, cash flow logic.
- **`client/src/lib/monthly-balances.ts`** — Monthly aggregation logic.
- **`client/src/lib/credit-cards.ts`** — Credit card payment tracking.
- **`client/src/lib/utils.ts`** — `formatCLP()`, `formatDate()`, and other helpers.

### Firebase Collections

`transactions`, `categories`, `items`, `budgets`, `clientPayments`, `clients`, `accounts`, `openingBalances`, `preferences`

### Multi-Workspace

Transactions and categories are scoped to a **workspace** field: `business`, `family`, or `dentist`. Filtering by workspace is handled throughout the UI and in `finance.ts`.

### Key Transaction Fields

`type` (income|expense), `subtype` (actual|planned), `status` (pending|paid|cancelled), `movementType`, `paymentMethod`, `accountId`, `workspace`

### Client Payments Status Flow

`projected` → `receivable` → `invoiced` → `paid` (or `cancelled`). Creating a `ClientPayment` with status `invoiced` or `paid` auto-generates a linked transaction.

## Build Notes

`npm run build` runs Vite then a post-process step that patches the output JS to remove IndexedDB references (Firebase Lite is used intentionally to avoid offline persistence and reduce bundle size).

## Path Aliases

- `@/` → `client/src/`
- `@shared/` → `shared/`
