import { Hono } from 'hono';
import { getSql } from '../db';

const app = new Hono();

app.get('/', async (c) => {
  try {
    const sql = getSql(c.env);
    const limit = Math.min(parseInt(c.req.query('limit') || '30'), 100);
    const result = await sql`
      SELECT * FROM products
      WHERE shops_count <= 2
      AND max_days_active <= 45
      AND product_score >= 10
      ORDER BY first_seen DESC
      LIMIT ${limit}
    `;
    return c.json({ count: result.length, products: result });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default app;
