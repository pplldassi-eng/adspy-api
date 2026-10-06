import { Hono } from 'hono';
import { getSql } from '../db';

const app = new Hono();

app.get('/', async (c) => {
  try {
    const sql = getSql(c.env);
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
    const result = await sql`
      SELECT 
        p.*,
        (SELECT a.image_url FROM product_ads pa 
         JOIN ads a ON a.id = pa.ad_id 
         WHERE pa.product_id = p.id AND a.image_url IS NOT NULL 
         LIMIT 1) as image_url,
        (SELECT a.video_url FROM product_ads pa 
         JOIN ads a ON a.id = pa.ad_id 
         WHERE pa.product_id = p.id AND a.video_url IS NOT NULL 
         LIMIT 1) as video_url
      FROM products p
      WHERE p.product_score >= 20
      ORDER BY p.product_score DESC, p.max_days_active DESC
      LIMIT ${limit}
    `;
    return c.json({ count: result.length, products: result });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default app;
