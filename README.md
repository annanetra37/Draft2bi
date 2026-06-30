# PaperLens — Snap-to-BI

Turn photos of handwritten **product lists, sales sheets, expense receipts, and
stock counts** into a live business-intelligence dashboard — with zero manual
data entry beyond correcting the fields the AI was unsure about.

> A shop owner who runs everything in a notebook photographs their pages. The
> system reads the handwriting, understands the structure, maps it to a clean
> database, lets the owner fix anything uncertain, and renders profit, stock,
> and demand on a dashboard.

This repository implements the [spec](./paperlens-spec.pdf)'s **vertical slice
first** strategy: the full nine-layer spine (Capture → Dashboard) is wired and
runnable end-to-end, then built for breadth.

---

## The nine layers (and where they live)

| # | Layer | Implementation |
|---|-------|----------------|
| 1 | **Capture** | `src/app/capture` — multi-image upload + one-tap demo pages |
| 2 | **Ingest & preprocess** | `src/app/api/upload`, `src/lib/storage.ts` — store + content-hash dedup |
| 3 | **Extract** ("the magic") | `src/lib/extract/*` — pluggable vision-LLM, per-field confidence |
| 4 | **Normalize & resolve** | `src/lib/resolve/*` — fuzzy catalogue match, units/dates/currency |
| 5 | **Review queue** | `src/app/review`, `src/app/api/review` — only the uncertain fields |
| 6 | **Canonical store** | `prisma/schema.prisma`, `src/lib/pipeline.ts` — commit + auto-decrement |
| 7 | **Metrics engine** | `src/lib/metrics/engine.ts` — the full Part D KPI catalogue |
| 8 | **Dashboard** | `src/app/page.tsx`, `src/components/Charts.tsx` — hero KPIs + drill-down |
| 9 | **Agent layer** | reorder-now / dead-stock / margin signals surface in the dashboard |

Critical sequencing (from the spec): **you cannot resolve a scribbled sale until
the product catalogue exists**, so onboarding ingests the price list first.

---

## Quick start

```bash
npm install
cp .env.example .env

docker compose up -d        # local PostgreSQL (matches the Railway plugin)
npm run db:migrate:dev      # apply migrations
npm run db:seed             # load a realistic demo dataset

npm run dev                 # http://localhost:3000
```

No Docker? Point `DATABASE_URL` in `.env` at any PostgreSQL instance and run the
same `db:migrate:dev` / `db:seed` steps.

Then:

1. Open **Dashboard** — it's already populated with ~45 days of seeded sales
   across the Cascade / Megamall / Online kiosks.
2. Open **Capture** → *Snap demo page* on a **sales sheet**. The pipeline reads
   it, fuzzy-matches products to the catalogue, and routes low-confidence fields
   to review.
3. Open **Review** — correct or accept the flagged fields beside their cropped
   image region. On clearing a page it auto-commits, and the numbers update.

No API key is required: with `ANTHROPIC_API_KEY` unset, a **deterministic mock
extractor** drives the whole flow. Set the key to read real photos with Claude
vision (see below).

---

## Extraction: Claude vision or mock

`src/lib/extract/index.ts` selects the backend:

- **`ANTHROPIC_API_KEY` set** → `ClaudeExtractor` prompts Claude per document
  type with a strict JSON schema and a calibrated confidence on **every field**
  (not per page), plus crop boxes for the review screen. Past human corrections
  are replayed as few-shot examples (`src/lib/extract/prompts.ts`).
- **unset, or `EXTRACTOR=mock`** → `MockExtractor` returns fixtures that mimic
  real reads — including Armenian handwriting, a crossed-out line, an ambiguous
  unit, and a margin total — so confidence routing is visible offline.

Multilingual handwriting (Armenian / mixed / Armenian numerals) is a
first-class requirement: it's modeled in the prompts, the demo fixtures, and the
unit/currency/weekday normalizers in `src/lib/resolve/normalize.ts`.

---

## What the metrics engine computes (Part D)

**Hero row:** net profit (+trend), revenue (+trend), gross margin %, units sold
+ best seller, most-profitable product, stock value (cost & retail), reorder-now
count, expense burn (+trend).

**Drill-downs:** revenue by day/location/category, sell-through, velocity,
best/slow movers, contribution margin per variant, *most-popular vs
most-profitable* scatter, days-of-cover, dead stock + tied-up cash, inventory
turnover, raw-material runway, material-cost %, expenses by category, and
system-health (data coverage, auto-approved rows).

Everything is filterable by date range and selling point. Every committed number
traces back to a `SourceImage`.

---

## Deploy to Railway

The repo ships ready for Railway (the spec's recommended host).

1. **New Project → Deploy from GitHub** and select this repo.
2. **Add a database:** *New → Database → PostgreSQL*.
3. On the app service, set variables (Variables tab):
   - `DATABASE_URL = ${{ Postgres.DATABASE_URL }}` — references the plugin.
   - `ANTHROPIC_API_KEY` — optional; without it the mock extractor runs.
   - `NEXT_PUBLIC_BASE_URL` — your Railway domain once assigned.
4. Deploy. Railway uses [`railway.json`](./railway.json):
   - **Build:** Nixpacks runs `npm install` (which runs `prisma generate`) then `npm run build`.
   - **Start:** `npx prisma migrate deploy && npm run start` — migrations apply on every deploy.
   - **Healthcheck:** [`/api/health`](./src/app/api/health/route.ts) verifies DB connectivity.
5. **Seed the demo data once** (optional) from the service shell:
   `npm run db:seed`.

**Persisting uploaded photos:** the demo SVG pages are data URLs in the DB and
need no disk. For real photo uploads, mount a Railway **volume** at
`/app/public/uploads` (or point `UPLOAD_DIR` at the mount). For scale, swap the
writer in `src/lib/storage.ts` for Cloudinary/S3 and return the remote URL.

## Database

PostgreSQL via Prisma. The schema (`prisma/schema.prisma`) deliberately avoids
native enums and the `Json` scalar to stay simple; migrations live in
`prisma/migrations/`. Locally, `docker-compose.yml` provisions a matching
Postgres. Apply schema changes with `npm run db:migrate:dev` (creates a
migration) and ship them with `npm run db:migrate` (`prisma migrate deploy`).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Dev server |
| `npm run build` | `prisma generate` + production build |
| `npm run db:migrate:dev` | Create + apply a migration (dev) |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`, prod) |
| `npm run db:seed` | Seed the demo dataset |
| `npm run db:reset` | Reset the database + reapply migrations + reseed |
| `npm run typecheck` | `tsc --noEmit` |

## Tech

Next.js 14 (App Router) · TypeScript · Tailwind · Recharts · Prisma · Zod ·
`@anthropic-ai/sdk`.
