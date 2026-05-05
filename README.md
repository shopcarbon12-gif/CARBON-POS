# Carbon POS

Point of Sale for **Carbon Jeans Company** — a companion app to
[CarbonWMS](https://wms.shopcarbon.com). Both apps run on the same Coolify
host and share a single Postgres database.

- **Public URL (production):** https://pos.shopcarbon.com
- **Coolify app:** `Carbon-pos` at http://178.156.136.112:8000/
  *(separate from the existing `carbon-wms` app on the same Coolify instance)*
- **Stack:** Next.js 16.2.1 · React 19 · TypeScript · Tailwind v4 · raw `pg` ·
  NextAuth v5 · Stripe Terminal · `node-thermal-printer` · Resend

This repo follows the **WMS pattern** for the data layer: a singleton
`pg` Pool exported from `lib/db.ts`, plain SQL strings with `$1, $2`
placeholders, no ORM, no query builder, plain `.sql` migration files.

## Architecture in one paragraph

POS owns every table prefixed `pos_*`. It reads `locations`, `custom_skus`,
`matrices`, `epcs`, and `users` from WMS by joining them in SQL. The only
WMS table POS writes to is `epcs.status`, and only inside the same
transaction that finalizes a sale (so a partial sale can never leave EPCs
marked sold while the `pos_sales` row was rolled back).

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Bring up CarbonWMS Postgres (or any Postgres that has the WMS schema)
#    See ../LOCAL-POSTGRES-5432.md for switching between WMS and carbon-gen.

# 3. Copy env file and fill in DATABASE_URL + Stripe + NextAuth secret
cp .env.example .env.local

# 4. Apply the POS migrations on top of the WMS schema
npm run db:migrate

# 5. (Optional) Seed one pos_location, one pos_register, one admin employee
cp migrations/seeds/000_bootstrap_first_location_and_admin.sql.example \
   migrations/seeds/000_bootstrap_first_location_and_admin.sql
# edit values, then:
psql "$DATABASE_URL" -f migrations/seeds/000_bootstrap_first_location_and_admin.sql

# 6. Run the dev server
npm run dev
# → http://localhost:3000
```

The first cashier you seed should sign in at `/sign-in` with their PIN.
Managers/admins can switch the sign-in screen to email + password mode to
reach `/admin`.

## Migrations

Every migration is an idempotent `.sql` file in `/migrations`. Apply them with:

```bash
npm run db:migrate          # runs every .sql file in numeric order
# or
psql "$DATABASE_URL" -f migrations/001_create_pos_tables.sql
```

Each file uses `CREATE TABLE IF NOT EXISTS` and wraps in `BEGIN`/`COMMIT`,
so re-running is safe.

## Routes

### Touch UI (`/pos/*`)

| Route | What it does |
|---|---|
| `/sign-in` | PIN keypad for cashiers, password fallback for managers |
| `/pos/register` | Open / close drawer, cash drops, cash payouts |
| `/pos` | Main sell screen — search, RFID scan, cart, totals |
| `/pos/payment` | Card / cash / split / check / store credit |
| `/pos/receipt` | Print thermal receipt or email it |
| `/pos/refund` | Search past sale, select lines, refund to original card / cash / store credit |

### Back office (`/admin/*`, manager + admin only)

| Route | What it does |
|---|---|
| `/admin` | Today's revenue, transactions, recent sales |
| `/admin/sales`, `/admin/reports`, etc | Phase 2 expansion |

### API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Coolify health check (verifies Postgres) |
| GET | `/api/pos/registers` | List registers with their currently-open session |
| GET / POST | `/api/pos/sessions` | Get current open session / open a new one |
| POST | `/api/pos/sessions/:id/close` | Close session, compute over/short |
| POST | `/api/pos/sessions/:id/cash-movement` | Cash drop or payout |
| GET | `/api/pos/items/search?q=` | Search `custom_skus` for the cart |
| POST | `/api/pos/items/by-epc` | Resolve scanned RFID EPCs to SKUs |
| POST | `/api/pos/payment/connection-token` | Stripe Terminal SDK token |
| POST | `/api/pos/payment/create-intent` | Manual-capture PaymentIntent |
| POST | `/api/pos/payment/process` | Send intent to a paired reader |
| POST | `/api/pos/payment/cancel` | Cancel reader action |
| POST | `/api/pos/payment/capture` | **Sale-finalize transaction** (see below) |
| POST | `/api/pos/payment/refund` | Stripe refund + reverse EPCs |
| GET | `/api/pos/sales?q=` | Search past sales |
| GET | `/api/pos/sales/:id` | Sale + lines + payments |
| POST | `/api/pos/sales/:id/print` | Send to thermal printer + kick drawer |
| POST | `/api/pos/sales/:id/email` | Email receipt via Resend |
| GET | `/api/pos/reports/end-of-day` | EOD totals (manager+) |

## The sale-finalize transaction

`/api/pos/payment/capture` is the only place POS writes both a sale and
flips an EPC. It does:

1. **Capture** every card `PaymentIntent` (manual-capture).
2. `BEGIN` —
   - Insert `pos_sales` (`status='completed'`)
   - Insert `pos_sale_lines`
   - Insert `pos_payments`
   - `UPDATE epcs SET status='sold' WHERE epc = ANY(...)`
   - Best-effort `INSERT INTO audit_log` inside a savepoint (so audit
     schema mismatches don't kill the sale)
   - `COMMIT`
3. If step 2 throws, **roll back the DB and refund every captured intent**
   so the customer is never charged for a sale that didn't persist.

Server re-derives subtotal/discount/tax/total from the lines — the client
total is never trusted.

## Stripe Terminal — dev vs. prod

- In dev set `NEXT_PUBLIC_STRIPE_TERMINAL_SIMULATED=1` and use a simulated
  reader from `stripe-terminal-js` — no physical hardware needed.
- In prod, pair each `pos_registers.stripe_reader_id` to either a Verifone
  P400 Plus or a BBPOS WisePOS E. The browser fetches a connection token
  from `/api/pos/payment/connection-token`, the cashier hits "Send to
  Reader," and the customer interacts with the reader directly.

## Coolify deployment

1. **App name:** `Carbon-pos` (separate from the `carbon-wms` app — both
   live on the same Coolify host at `178.156.136.112:8000`).
2. **Build:** Nixpacks auto-detects Next.js. No Dockerfile required.
3. **Public domain:** add `pos.shopcarbon.com` in the Coolify UI; auto SSL
   via Let's Encrypt.
4. **Environment variables:**
   ```
   DATABASE_URL=<same Postgres URL as carbon-wms>
   NEXTAUTH_SECRET=<openssl rand -base64 32>
   NEXTAUTH_URL=https://pos.shopcarbon.com
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   RESEND_API_KEY=re_...
   RECEIPT_FROM_EMAIL=receipts@shopcarbon.com
   THERMAL_PRINTER_HOST=<receipt printer LAN IP>
   THERMAL_PRINTER_PORT=9100
   ```
5. **Health check path:** `/api/health` — returns `{ ok: true }` only when
   Postgres responds.
6. **First deploy:** after the container is up, run `npm run db:migrate`
   from the Coolify console (or hit Postgres directly with `psql`) to apply
   `migrations/001_create_pos_tables.sql`, then run the bootstrap seed to
   create the first `pos_location`, `pos_register`, and admin employee.

The two apps share the same Postgres user/database. POS only ever issues a
single `UPDATE epcs SET status='sold'` against WMS-owned data.

## Phase 1 / Phase 2 status

**Shipped (Phase 1):** project skeleton, schema, migrations, NextAuth (PIN
+ password), register open/close + cash movements, sell screen with item
search & RFID scan, cart math + tax, full Stripe Terminal endpoints, sale
capture transaction with EPC update, receipt print + email, refund flow,
admin dashboard, end-of-day report, health check.

**Phase 2 (todo):** color/size matrix picker, hold/park multiple sales,
manager-PIN gates, customer CRUD UI in /admin, discount-rules engine,
clock in/out + hours report, store-credit issuance/redemption, offline
write queue, full reports + CSV export.
