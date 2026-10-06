import { Hono } from 'hono';
import { cors } from 'hono/cors';
import topWinners from './routes/topWinners';
import blueOcean from './routes/blueOcean';
import shops from './routes/shops';
import stats from './routes/stats';

const app = new Hono();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.get('/', (c) => c.json({
  name: 'AdSpy Africa API',
  version: '1.0.0',
  endpoints: [
    '/api/top-winners',
    '/api/blue-ocean',
    '/api/shops',
    '/api/stats',
  ],
}));

app.route('/api/top-winners', topWinners);
app.route('/api/blue-ocean', blueOcean);
app.route('/api/shops', shops);
app.route('/api/stats', stats);

export default app;
