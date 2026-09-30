# Technic Technologies Electronics ERP — Implementation Progress

## Status: Production-ready pending user acceptance testing

> Last updated: 2026-09-30 (session: env cleanup + live database bring-up)

## Live Database: CONNECTED & SEEDED ✅

The `.env` now contains a real Neon PostgreSQL `DATABASE_URL`, `AUTH_SECRET`,
`NEXTAUTH_URL`, and `APP_NAME="Technic Technologies ERP"`. As of this session:

- `npx prisma migrate deploy` — **clean** ("No pending migrations to apply",
  `0_init` finished, all 47 tables present).
- `npm run db:seed` — **complete**: 52 permissions / 231 role grants, 8 users
  (logins 900001–900008), 2 bcrypt access codes, 10 products + 2 variants,
  3 suppliers, 8 customers, opening stock, 4 demo invoices (2 GST + 2 non-GST)
  with payments, serials and warranties.
- Fixed during seeding: `seedSuppliers` used `terms` instead of the schema's
  `paymentTerms` field ([prisma/seed.ts](prisma/seed.ts)).
- `npx tsc --noEmit` — **0 errors** after cleanup.

## Environment Variables — What Actually Matters

Only **four** variables are read by the app (verified by grepping all
`process.env.*` usage; see [.env.example](.env.example)):

| Variable | Purpose | Notes |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection | Neon/local/Supabase — any Postgres 14+ |
| `AUTH_SECRET` | NextAuth v5 JWT signing | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Canonical app URL | `http://localhost:3000` for dev |
| `APP_NAME` | Display-name fallback | Seeded firm name takes priority at runtime |

Removed this session: `[TEMPLATE]` header, `aura_erp` URL, `APP_NAME="Aura Laundry"`,
and all inert STORAGE_*, PAYMENT_*, RAZORPAY_*, UPI_*, EMAIL_*, OPENWA_* blocks
(nothing in `src/` reads them). Also deleted the orphaned
`scripts/openwa-server.mjs` (WhatsApp gateway, already removed from package.json).
The user's `.env` was trimmed to the same minimal set with secrets preserved.

## Setup Instructions

```bash
cp .env.example .env   # then fill in DATABASE_URL / AUTH_SECRET / NEXTAUTH_URL
npx prisma migrate deploy
npm run db:seed        # optional: demo data
npm run dev            # http://localhost:3000
```

## Login Credentials (seeded)

| Login | Role | 
| --- | --- |
| 900001 | Super Admin (PLATFORM_ADMIN) |
| 900002 | Admin |
| 900003 | Manager |
| 900004 | Accountant |
| 900005 | Sales Staff (MG Road branch) |
| 900006 | Purchase Staff |
| 900007 | Inventory Manager |
| 900008 | Viewer |

Access codes (bcrypt-hashed in DB; enter on first login):
- GST mode: `TECH-GST-4821`
- Non-GST mode: `TECH-NONGST-9134`

## Implemented (all pages under `src/app/(app)`)

- **Auth & security**: 6-digit access-code login (NextAuth v5), GST/NON-GST
  session mode via `unstable_update`, backend 403 enforcement in API routes,
  permission checks per route.
- **POS terminal** (`pos/`): barcode/serial/IMEI lookup, cart with client-side
  tax preview, server-side checkout (`checkoutAction`) enforcing session mode;
  authoritative tax math lives in `computeTaxSummary` inside
  [src/lib/services/sales.ts](src/lib/services/sales.ts) `createInvoice`.
- **Invoices**: list, detail, cancel; Tax Invoice vs Bill of Supply PDFs via
  [/api/documents/[kind]/[id]](src/app/api/documents).
- **Quotations** (+convert), **sales orders**, **sales returns** (+approve),
  **payments** (+record), **customers** (+add).
- **Purchases**: orders, goods receipts (with serial capture), bills,
  purchase returns; suppliers (+add).
- **Products** (+detail), **inventory** (stock, adjustments, transfers),
  **serials** (with IMEI), **warranty** (lookup + claim).
- **Expenses** (+approve), **reports** (GST summary locked to GST mode,
  403 outside), **search**, **audit**.
- **Admin**: users (+new 6-digit), roles, firms (enter-firm), access-codes
  (one-time plaintext reveal), settings, audit log.
- **APIs**: documents PDF, CSV export (rate-limited; gst-summary 403s outside
  GST mode), POS lookup, product/customer/supplier/branch pickers.
- **PDF layer**: [src/lib/pdf/pdf-templates.ts](src/lib/pdf/pdf-templates.ts) —
  Tax Invoice (HSN + CGST/SGST/IGST), Bill of Supply, Quotation, Purchase Order,
  Purchase Bill, Payment Receipt, Expense Receipt; Technic branding.

## Verification Log — 30 Sep 2026 (live UI + DB cross-checks)

All tests below were executed against the live app in a real browser with DB
state verified after every action (`scripts/db-check.mjs`).

### Passed

| Area | Test | Result |
|------|------|--------|
| POS | GST checkout (S24, serial, cash) | TT/GST/26-27/0005 · PAID · serial SOLD · SALE_OUT · payment row |
| POS | Non-GST checkout | TT/NG/26-27/0005 (earlier pass) |
| POS | Serial-product mismatch rejected | "belongs to a different product" — nothing saved |
| PDF | Invoice PDF download | 200, application/pdf, %PDF magic, 434 KB |
| Payments | Advance without invoice | TT/PAY/26-27/0006 recorded as advance |
| Payments | Invoice-linked payment (new UI) | 0005 → PAID, due 0.00 |
| Invoices | Cancel with reason | status CANCELLED, serial RETURNED, SALE_RETURN_IN, audit row |
| Quotations | Create via new dialog | TT/QT/26-27/0001 |
| Quotations | Convert → invoice | quotation CONVERTED, TT/GST/26-27/0006 |
| Returns | Create + approve + refund | TT/SR/26-27/0001 APPROVED, stock restored, refund TT/PAY/26-27/0008 |
| Purchases | GRN without PO + serial capture | TT/PI/26-27/0013, serial IN_STOCK, PURCHASE_IN txn |
| Pages | invoices, products, sales-orders, payments, quotations, purchases, sales-returns | all render with correct data/empty states |
| Build | `tsc --noEmit` + `next build` | both clean |

### Fixed this session

1. **POS overcharge (tax math)** — server billed GST-exclusive on top of
   tax-inclusive shelf prices (₹74,999 tag became an ₹88,499 bill).
   `computeTaxSummary` now treats `unitPrice` as GST-inclusive; POS preview and
   server agree. Seed demo invoices recomputed to match.
2. **Sequence collision after reseed** — seed hand-created invoices without
   advancing `document_sequences`; first real sale collided and silently rolled
   back. Seed now upserts counters derived from the seeded maxima.
3. **Prisma timeout on Neon** — long transactions died at the default 5 s.
   `src/lib/prisma.ts` now sets `maxWait 5s / timeout 30s`.
4. **Missing invoice-payment UI** — payments could only be recorded as
   customer advances; no way to pay an invoice. Added "Record payment" dialog
   on the invoice detail page (perm `payments.create`, validates balance).
5. **Quotations could not be created** — service + convert flow existed but no
   UI entry point. Added "New quotation" dialog on the quotations page.
6. **Sales returns could not be created** — approve-only UI. Added "New
   return" dialog on the invoice detail page (serial-aware, reason required).
7. **GRN without PO was impossible** — baseline migration created
   `goods_receipts.poId` NOT NULL while the schema declares it optional.
   Corrective migration `20260930170000_goods_receipt_po_optional` applied;
   over-the-counter receipts now work (verified live).
8. **Stale-branch hardening** — `requireWriteBranch` now validates the
   session's fallback branch against the DB, so deleted/recreated branches
   produce a friendly sign-in message instead of an opaque FK failure.

### Known limitations

- §55–56 WhatsApp/email sharing is intentionally out of scope (removed per
  handover); the WhatsApp tables remain for future use.
- Single verification browser profile; HMR websocket noise in dev does not
  affect production builds.

## Remaining Work

- Replace demo access codes (900001–900008) and firm mode codes before go-live.
- Optional polish: PDF visual review against printed samples, CSV column tweaks.
- Deployment hardening if going to production (HTTPS, managed Postgres,
  backup policy).

## Gotchas & Notes

- Prisma 7: generated client lives at `src/generated/prisma`; scripts must
  construct the client with `new PrismaPg({ connectionString })`.
- Windows bash mangles heredocs (CRLF) — write temp scripts to files instead.
- `migrate diff` uses `--to-schema` (not `--to-schema-datamodel`) on Prisma 7.
- Stale `.next/types` errors after route deletion: `rm -rf .next/types`.
- Neon pooler may transiently time out on `pg_advisory_lock` — retry works.
- `code_search` (ripgrep) can fail with ENOENT on this machine — use bash grep.
