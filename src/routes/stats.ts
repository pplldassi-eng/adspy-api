import { Hono } from 'hono';
import { getPool } from '../db';

const app = new Hono();

app.get('/', async (c) => {
  try {
    const pool = getPool(c.env);
    const [total, byCountry, byKeyword, topCategories] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM ads'),
      pool.query('SELECT country, COUNT(*) as count FROM ads GROUP BY country ORDER BY count DESC'),
      pool.query('SELECT keyword, COUNT(*) as count FROM ads GROUP BY keyword ORDER BY count DESC LIMIT 20'),
      pool.query('SELECT category, COUNT(*) as count FROM products WHERE category IS NOT NULL GROUP BY category ORDER BY count DESC LIMIT 15'),
    ]);
    return c.json({
      total_ads: parseInt(total.rows[0].total),
      by_country: byCountry.rows,
      by_keyword: byKeyword.rows,
      top_categories: topCategories.rows,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default app;
