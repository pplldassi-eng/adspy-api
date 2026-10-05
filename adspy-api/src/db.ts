import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(env: any): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}
