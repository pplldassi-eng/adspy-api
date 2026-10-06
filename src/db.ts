import { neon } from '@neondatabase/serverless';

export function getSql(env: any) {
  return neon(env.DATABASE_URL);
}
