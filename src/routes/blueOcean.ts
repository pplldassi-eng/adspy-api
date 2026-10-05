import { Hono } from 'hono';
import { getPool } from '../db';

const app = new Hono();

app.get('/', async (c) => {
  try {
    const pool = getPool(c.env);
    const limit = Math.min(parseInt(c.req.query('limit') || '30'), 100);
    const result = await pool.query(
      `SELECT * FROM products
       WHERE shops_count <= 2
       AND max_days_active <= 45
       AND product_score >= 10
       ORDER BY first_seen DESC
       LIMIT $1`,
      [limit]
    );
    return c.json({ count: result.rowCount, products: result.rows });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default app;
