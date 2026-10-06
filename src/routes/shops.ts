import { Hono } from 'hono';
import { getSql } from '../db';

const app = new Hono();

app.get('/', async (c) => {
  try {
    const sql = getSql(c.env);
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
    const result = await sql`
      SELECT 
        advertiser,
        COUNT(*) as ads_count,
        COUNT(DISTINCT keyword) as keywords_count,
        ROUND(AVG(days_active)) as avg_days,
        MAX(days_active) as max_days,
        MAX(score) as max_score,
        ARRAY_AGG(DISTINCT country) as countries,
        MIN(price) as price_min,
        MAX(price) as price_max
      FROM ads
      WHERE advertiser IS NOT NULL AND advertiser != ''
      GROUP BY advertiser
      ORDER BY COUNT(*) DESC, MAX(score) DESC
      LIMIT ${limit}
    `;
    return c.json({ count: result.length, shops: result });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default app;
