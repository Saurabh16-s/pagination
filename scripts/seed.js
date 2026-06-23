/**
 * Seed script — generates 200,000 products fast.
 *
 * Naive approach: INSERT in a loop → 200k round-trips, very slow.
 * This approach: build arrays in JS, pass to PostgreSQL's unnest(),
 * which lets Postgres do a single bulk insert from the arrays.
 * On a local Postgres this runs in ~3-5 seconds vs ~60-120s for a loop.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/seed.js
 */

require('dotenv').config({path:'../backend/.env'});
const {Pool}=require('pg');

const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});

const CATEGORIES=['Electronics','Clothing','Books','Home & Garden','Sports','Toys','Automotive','Food','Beauty','Office'];
const ADJECTIVES=['Premium','Classic','Modern','Vintage','Sleek','Durable','Compact','Pro','Ultra','Lite'];
const NOUNS=['Widget','Gadget','Device','Tool','Kit','Pack','Set','Bundle','Edition','Series'];

function rand(arr){return arr[Math.floor(Math.random()*arr.length)];}
function randPrice(){return (Math.random()*990+10).toFixed(2);}
function randDate(start,end){
  return new Date(start.getTime()+Math.random()*(end.getTime()-start.getTime()));
}

async function seed(){
  const client=await pool.connect();
  try {
    console.log('Creating table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT NOT NULL,
        category    TEXT NOT NULL,
        price       NUMERIC(10,2) NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Composite index that makes cursor pagination O(page_size)
    // Without this, every page would do a full table scan
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_created_at_id
      ON products (created_at DESC, id DESC)
    `);

    // Index for category filter + cursor (covering index)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_products_category_created_at_id
      ON products (category, created_at DESC, id DESC)
    `);

    console.log('Seeding 200,000 products...');
    const start=Date.now();

    const TOTAL=200_000;
    const BATCH=10_000; // unnest in batches to avoid huge memory spikes

    const dateStart=new Date('2023-01-01');
    const dateEnd=new Date('2025-12-31');

    for(let offset=0;offset<TOTAL;offset+=BATCH){
      const count=Math.min(BATCH,TOTAL-offset);
      const names=[],categories=[],prices=[],created_ats=[],updated_ats=[];

      for(let i=0;i<count;i++){
        const name=`${rand(ADJECTIVES)} ${rand(NOUNS)} ${offset+i+1}`;
        const cat=rand(CATEGORIES);
        const price=randPrice();
        const created=randDate(dateStart,dateEnd);
        // updated_at >= created_at
        const updated=randDate(created,dateEnd);

        names.push(name);
        categories.push(cat);
        prices.push(price);
        created_ats.push(created.toISOString());
        updated_ats.push(updated.toISOString());
      }

      // Single INSERT via unnest — one round-trip per batch
      await client.query(`
        INSERT INTO products (name, category, price, created_at, updated_at)
        SELECT * FROM unnest(
          $1::text[],
          $2::text[],
          $3::numeric[],
          $4::timestamptz[],
          $5::timestamptz[]
        )
      `,[names,categories,prices,created_ats,updated_ats]);

      const pct=Math.round((offset+count)/TOTAL*100);
      process.stdout.write(`\r  ${offset+count}/${TOTAL} (${pct}%)`);
    }

    const elapsed=((Date.now()-start)/1000).toFixed(1);
    console.log(`\nDone! 200,000 products inserted in ${elapsed}s`);

    // Verify
    const {rows}=await client.query('SELECT COUNT(*) FROM products');
    console.log(`Total rows in DB: ${rows[0].count}`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err=>{console.error(err);process.exit(1);});
