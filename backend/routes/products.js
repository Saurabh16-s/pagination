const router=require('express').Router();
const pool=require('../db');

router.get('/',async(req,res)=>{
  try {
    const limit=Math.min(parseInt(req.query.limit)||20,100);
    const category=req.query.category||null;
    let cursorCreatedAt=null,cursorId=null;

    if(req.query.cursor){
      try {
        const decoded=JSON.parse(Buffer.from(req.query.cursor,'base64url').toString('utf8'));
        cursorCreatedAt=decoded.created_at;
        cursorId=decoded.id;
      } catch {
        return res.status(400).json({error:'Invalid cursor'});
      }
    }

    const params=[];
    let idx=1;
    let where='WHERE 1=1';

    if(category){where+=` AND category=$${idx++}`;params.push(category);}
    if(cursorCreatedAt&&cursorId){
      where+=` AND (created_at,id)<($${idx++}::timestamptz,$${idx++}::uuid)`;
      params.push(cursorCreatedAt,cursorId);
    }
    params.push(limit+1);

    const {rows}=await pool.query(`
      SELECT id,name,category,price,created_at,updated_at
      FROM products ${where}
      ORDER BY created_at DESC,id DESC
      LIMIT $${idx}
    `,params);

    const hasMore=rows.length>limit;
    const items=hasMore?rows.slice(0,limit):rows;
    let nextCursor=null;
    if(hasMore){
      const last=items[items.length-1];
      nextCursor=Buffer.from(JSON.stringify({created_at:last.created_at,id:last.id})).toString('base64url');
    }

    res.json({data:items,next_cursor:nextCursor,has_more:hasMore,count:items.length});
  } catch(err){
    console.error(err);
    res.status(500).json({error:'Internal server error'});
  }
});

router.get('/categories',async(_req,res)=>{
  try {
    const {rows}=await pool.query('SELECT DISTINCT category FROM products ORDER BY category');
    res.json(rows.map(r=>r.category));
  } catch(err){
    console.error(err);
    res.status(500).json({error:'Internal server error'});
  }
});

module.exports=router;