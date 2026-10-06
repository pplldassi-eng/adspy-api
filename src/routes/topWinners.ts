import { Hono } from 'hono';
import { getSql } from '../db';

const app = new Hono();

app.get('/', async (c) => {
  try {
    const sql = getSql(c.env);
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
    const result = await sql`
      SELECT * FROM products
      WHERE product_score >= 20
      ORDER BY product_score DESC, max_days_active DESC
      LIMIT ${limit}
    `;
    return c.json({ count: result.length, products: result });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default app;
