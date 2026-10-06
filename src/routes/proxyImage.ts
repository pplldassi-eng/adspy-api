import { Hono } from 'hono';

const app = new Hono();

app.get('/', async (c) => {
  const url = c.req.query('url');
  if (!url) {
    return c.json({ error: 'url parameter required' }, 400);
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Referer': 'https://www.facebook.com/',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Cookie': 'datr=fake-cookie-for-hotlink-bypass',
      },
    });

    if (!res.ok) {
      return c.json({ error: `Facebook returned ${res.status}` }, 502);
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = await res.arrayBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default app;
