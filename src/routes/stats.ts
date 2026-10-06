import { Hono } from 'hono';
import { getSql } from '../db';

const app = new Hono();

app.get('/', async (c) => {
  try {
    const sql = getSql(c.env);
    const total = await sql`SELECT COUNT(*) as total FROM ads`;
    const byCountry = await sql`SELECT country, COUNT(*) as count FROM ads GROUP BY country ORDER BY count DESC`;
    const byKeyword = await sql`SELECT keyword, COUNT(*) as count FROM ads GROUP BY keyword ORDER BY count DESC LIMIT 20`;
    const topCategories = await sql`SELECT category, COUNT(*) as count FROM products WHERE category IS NOT NULL GROUP BY category ORDER BY count DESC LIMIT 15`;
    return c.json({
      total_ads: parseInt(total[0].total),
      by_country: byCountry,
      by_keyword: byKeyword,
      top_categories: topCategories,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default app;
