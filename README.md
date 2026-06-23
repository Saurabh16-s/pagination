# Product Catalog — CodeVector Take-Home

A backend that lets someone browse ~200,000 products (newest first), filter by category, and paginate through them — correctly, even while data changes.

## Live URLs

- **API:** `https://your-backend.onrender.com`
- **Frontend:** `https://your-frontend.pages.dev` (or Vercel/Netlify)

---

## The Core Engineering Decision: Cursor Pagination

### Why not OFFSET?

```sql
-- Standard OFFSET pagination (broken for live data)
SELECT * FROM products ORDER BY created_at DESC LIMIT 20 OFFSET 40;
```

**Problem 1 — Performance:** OFFSET 40 means Postgres scans and discards 40 rows before returning 20. At OFFSET 100,000 that's 100,000 wasted row reads. This gets slower as you page deeper.

**Problem 2 — Correctness under live writes:** If 50 new products are inserted while a user is on page 3, every row shifts. Page 4 now contains what used to be the end of page 3 — the user sees duplicates. Or rows get pushed past the current offset and are silently skipped.

### The fix: Keyset/Cursor pagination

```sql
-- Cursor pagination (stable and fast)
SELECT * FROM products
WHERE (created_at, id) < ($cursor_created_at, $cursor_id)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

**How it works:**
- Instead of "skip N rows", we anchor to a specific row: "give me products older than this one."
- The cursor encodes the `(created_at, id)` of the last row on the current page.
- `id` is the tiebreaker — if two products share the same `created_at` timestamp, `id` (UUID) ensures a deterministic stable order.
- Inserting new products never shifts old rows relative to each other. A user browsing page 3 will never see duplicates or skip items regardless of concurrent writes.

**Performance:** With a composite index on `(created_at DESC, id DESC)`, Postgres uses an index range scan — O(page_size), not O(total_rows + offset).

### The index

```sql
-- Primary pagination index
CREATE INDEX idx_products_created_at_id ON products (created_at DESC, id DESC);

-- Covering index for category-filtered queries
CREATE INDEX idx_products_category_created_at_id ON products (category, created_at DESC, id DESC);
```

With the category index, a filtered query (`WHERE category = 'Electronics' AND (created_at, id) < (...)`) never touches the main table heap for pages after the first — it reads directly from the index.

### What cursor pagination can't do

- **No random access** — can't jump to "page 47". This is fine for infinite-scroll or sequential browsing.
- **Back-navigation requires cursor stack** — the frontend maintains a stack of cursors so "previous page" works correctly. See `frontend/index.html`.

---

## Project Structure

```
.
├── backend/
│   ├── index.js          # Express API server
│   ├── package.json
│   └── .env.example
├── scripts/
│   ├── seed.js           # Generates 200k products (bulk insert via unnest)
│   └── package.json
├── frontend/
│   └── index.html        # Single-file UI (HTML + CSS + vanilla JS)
└── README.md
```

---

## Running Locally

### 1. Database (Neon or local Postgres)

```bash
# Local:
createdb products_db

# Or use Neon free tier and grab the connection string
```

### 2. Backend

```bash
cd backend
cp .env.example .env
# Set DATABASE_URL in .env
npm install
npm start
# → http://localhost:3000
```

### 3. Seed the database

```bash
cd scripts
npm install
DATABASE_URL=postgres://... node seed.js
# Inserts 200,000 products in ~3-5 seconds via unnest bulk insert
```

### 4. Frontend

```bash
# Edit frontend/index.html — change API_BASE to http://localhost:3000
# Open in browser directly, or serve with:
npx serve frontend
```

---

## API Reference

### `GET /products`

| Param | Type | Description |
|-------|------|-------------|
| `limit` | number | Page size. Default 20, max 100 |
| `category` | string | Filter by category (optional) |
| `cursor` | string | Opaque cursor from previous response (optional) |

**Response:**
```json
{
  "data": [...],
  "next_cursor": "eyJjcmVhdGVkX2F0IjoiMjAy...",
  "has_more": true,
  "count": 20
}
```

The cursor is a base64url-encoded JSON string `{created_at, id}`. Treat it as opaque — pass it back verbatim for the next page.

### `GET /categories`

Returns an array of distinct category strings.

### `GET /health`

Health check. Returns `{"status":"ok"}`.

---

## Seed Script Design

Naive approach — loop with individual INSERTs:
```js
for (let i = 0; i < 200_000; i++) {
  await db.query('INSERT INTO products ...', [values]); // 200k round-trips
}
// Takes ~60-120 seconds
```

Fast approach — batch via `unnest()`:
```sql
INSERT INTO products (name, category, price, created_at, updated_at)
SELECT * FROM unnest($1::text[], $2::text[], $3::numeric[], $4::timestamptz[], $5::timestamptz[])
```

One round-trip per 10,000 rows. 200k rows in ~3-5 seconds.

---

## Deployment

### Backend → Render

1. Push repo to GitHub
2. New Web Service → connect repo
3. Root dir: `backend`, build: `npm install`, start: `node index.js`
4. Add env var: `DATABASE_URL`

### Database → Neon

1. Create free project at neon.tech
2. Copy connection string → Render env var
3. Run seed script once: `DATABASE_URL=<neon-url> node scripts/seed.js`

### Frontend → Netlify/Vercel/Cloudflare Pages

1. Change `API_BASE` in `frontend/index.html` to your Render URL
2. Deploy `frontend/` folder to Netlify (drag & drop) or Cloudflare Pages

---

## What I'd Improve With More Time

1. **Elasticsearch / full-text search** — filter by keyword across name/description, with relevance scoring.
2. **Elastic IP / edge caching** — put the API behind a CDN; category lists and popular pages can be cached at the edge.
3. **Total count estimate** — Postgres `COUNT(*)` on 200k rows is fast enough, but at 10M+ rows you'd use `pg_class.reltuples` for an estimate instead.
4. **Rate limiting** — add `express-rate-limit` on the API.
5. **Input validation** — use `zod` or `joi` to validate query params.
6. **Tests** — integration tests hitting a test DB with known data, asserting cursor correctness across inserts.

---

## How I Used AI

**What AI helped with:**
- Boilerplate Express setup (saving ~10 min)
- The CSS for the frontend UI — I described the aesthetic I wanted, AI generated the stylesheet, I reviewed and trimmed it
- Writing this README faster

**What I figured out myself / caught AI getting wrong:**
- The core cursor logic — AI initially suggested `WHERE created_at < $cursor_date` which breaks if multiple products share the same timestamp. I corrected it to the composite `(created_at, id) < (cursor_date, cursor_id)` row-value comparison.
- Index design — AI suggested a single-column index on `created_at`. I added `id` to the index and created the separate category+cursor covering index.
- The `unnest()` bulk insert pattern — AI suggested `pg-copy-streams` (more complex). I knew `unnest()` is simpler and equally fast for this size.
- Frontend cursor stack for back-navigation — AI's first draft only supported forward pagination.
