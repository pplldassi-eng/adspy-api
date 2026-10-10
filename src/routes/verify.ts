import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';

type Env = {
  DATABASE_URL: string;
  TEXT_GEN_API_KEY: string;
};

const verify = new Hono<{ Bindings: Env }>();

const TEXT_GEN_URL =
  'https://text-generation.pplldassi.workers.dev/classify';

async function fetchHtml(url: string): Promise<string | null> {
  try {
    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    const response = await fetch(cleanUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`HTTP ${response.status} for ${cleanUrl}`);
      return null;
    }

    return await response.text();
  } catch (err: any) {
    console.error(`Fetch error for ${url}:`, err.message);
    return null;
  }
}

async function classifyShop(
  shopName: string,
  shopUrl: string,
  html: string,
  apiKey: string
): Promise<{
  isRealEcommerce: boolean;
  confidence: number;
  reason: string;
  category: string;
} | null> {
  try {
    const response = await fetch(TEXT_GEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        shopName,
        shopUrl,
        html: html.substring(0, 20000),
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Text-gen error ${response.status}:`, errText);
      return null;
    }

    const data: any = await response.json();
    if (!data.success || !data.verdict) {
      console.error('Bad text-gen response:', data);
      return null;
    }

    return data.verdict;
  } catch (err: any) {
    console.error(`Classify error for ${shopName}:`, err.message);
    return null;
  }
}

function computeTrustScore(
  confidence: number,
  shopScore: number
): number {
  let score = confidence * 0.7;
  if (shopScore >= 100) score += 15;
  else if (shopScore >= 50) score += 10;
  else if (shopScore >= 20) score += 5;
  return Math.min(Math.round(score), 100);
}

verify.post('/batch', async (c) => {
  const sql = neon(c.env.DATABASE_URL);
  const url = new URL(c.req.url);
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);
  const minScore = parseInt(url.searchParams.get('minScore') || '0', 10);

  try {
    const shops: any[] = await sql`
      SELECT id, name, channel_url, shop_score
      FROM shops
      WHERE channel_url IS NOT NULL
        AND channel_url != ''
        AND is_physical_ecommerce IS NULL
        AND shop_score >= ${minScore}
      ORDER BY shop_score DESC
      LIMIT ${limit}
    `;

    if (shops.length === 0) {
      return c.json({
        success: true,
        message: 'Aucune boutique à vérifier',
        total: 0,
        verified: 0,
        accepted: 0,
        rejected: 0,
        results: [],
      });
    }

    const results: any[] = [];
    let verifiedCount = 0;
    let acceptedCount = 0;

    for (const shop of shops) {
      const html = await fetchHtml(shop.channel_url);

      if (!html) {
        await sql`
          UPDATE shops
          SET is_physical_ecommerce = FALSE,
              trust_score = 0,
              verification_reason = 'Site inaccessible ou timeout',
              verified_at = NOW()
          WHERE id = ${shop.id}
        `;
        results.push({
          shop: shop.name,
          url: shop.channel_url,
          status: 'inaccessible',
          isRealEcommerce: false,
        });
        verifiedCount++;
        continue;
      }

      const verdict = await classifyShop(
        shop.name,
        shop.channel_url,
        html,
        c.env.TEXT_GEN_API_KEY
      );

      if (!verdict) {
        results.push({
          shop: shop.name,
          url: shop.channel_url,
          status: 'ai_error',
          isRealEcommerce: null,
        });
        continue;
      }

      const trustScore = computeTrustScore(
        verdict.confidence,
        shop.shop_score
      );

      await sql`
        UPDATE shops
        SET is_physical_ecommerce = ${verdict.isRealEcommerce},
            trust_score = ${trustScore},
            category = ${verdict.category},
            verification_reason = ${verdict.reason},
            verified_at = NOW()
        WHERE id = ${shop.id}
      `;

      verifiedCount++;
      if (verdict.isRealEcommerce) acceptedCount++;

      results.push({
        shop: shop.name,
        url: shop.channel_url,
        status: 'verified',
        isRealEcommerce: verdict.isRealEcommerce,
        confidence: verdict.confidence,
        trustScore,
        category: verdict.category,
        reason: verdict.reason,
      });
    }

    return c.json({
      success: true,
      total: shops.length,
      verified: verifiedCount,
      accepted: acceptedCount,
      rejected: verifiedCount - acceptedCount,
      results,
    });
  } catch (err: any) {
    return c.json(
      { error: 'Verify batch failed', details: err.message },
      500
    );
  }
});

verify.post('/:shopId', async (c) => {
  const sql = neon(c.env.DATABASE_URL);
  const shopIdParam = c.req.param('shopId');

  if (shopIdParam === 'batch') {
    return c.json({ error: 'Use POST /batch instead' }, 400);
  }

  const shopId = parseInt(shopIdParam, 10);
  if (isNaN(shopId)) {
    return c.json({ error: 'Invalid shopId' }, 400);
  }

  try {
    const shops: any[] = await sql`
      SELECT id, name, channel_url, shop_score
      FROM shops
      WHERE id = ${shopId}
    `;

    if (shops.length === 0) {
      return c.json({ error: 'Shop not found' }, 404);
    }

    const shop = shops[0];
    if (!shop.channel_url) {
      return c.json({ error: 'Shop has no URL to verify' }, 400);
    }

    const html = await fetchHtml(shop.channel_url);
    if (!html) {
      await sql`
        UPDATE shops
        SET is_physical_ecommerce = FALSE,
            trust_score = 0,
            verification_reason = 'Site inaccessible ou timeout',
            verified_at = NOW()
        WHERE id = ${shopId}
      `;
      return c.json({
        success: false,
        shop: shop.name,
        url: shop.channel_url,
        status: 'inaccessible',
        isRealEcommerce: false,
      });
    }

    const verdict = await classifyShop(
      shop.name,
      shop.channel_url,
      html,
      c.env.TEXT_GEN_API_KEY
    );

    if (!verdict) {
      return c.json({
        success: false,
        shop: shop.name,
        url: shop.channel_url,
        status: 'ai_error',
      });
    }

    const trustScore = computeTrustScore(
      verdict.confidence,
      shop.shop_score
    );

    await sql`
      UPDATE shops
      SET is_physical_ecommerce = ${verdict.isRealEcommerce},
          trust_score = ${trustScore},
          category = ${verdict.category},
          verification_reason = ${verdict.reason},
          verified_at = NOW()
      WHERE id = ${shopId}
    `;

    return c.json({
      success: true,
      shop: shop.name,
      url: shop.channel_url,
      isRealEcommerce: verdict.isRealEcommerce,
      trustScore,
      category: verdict.category,
      reason: verdict.reason,
    });
  } catch (err: any) {
    return c.json(
      { error: 'Verify failed', details: err.message },
      500
    );
  }
});

export default verify;
