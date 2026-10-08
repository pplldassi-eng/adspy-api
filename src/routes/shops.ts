import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';

type Env = {
  DATABASE_URL: string;
};

const shops = new Hono<{ Bindings: Env }>();

// Route : Liste des boutiques avec leurs stats
shops.get('/', async (c) => {
  const sql = neon(c.env.DATABASE_URL);
  
  const result = await sql`
    SELECT 
      s.id,
      s.name,
      s.total_ads,
      s.total_products,
      s.active_days,
      s.shop_score,
      s.categories,
      s.first_seen,
      -- Récupérer la dernière image de pub de cette boutique
      (SELECT a.image_url FROM ads a WHERE a.shop_id = s.id AND a.image_url IS NOT NULL ORDER BY a.scraped_at DESC LIMIT 1) as last_image,
      -- Récupérer la dernière vidéo
      (SELECT a.video_url FROM ads a WHERE a.shop_id = s.id AND a.video_url IS NOT NULL ORDER BY a.scraped_at DESC LIMIT 1) as last_video
    FROM shops s
    WHERE s.total_ads > 0
    ORDER BY s.shop_score DESC
    LIMIT 50
  `;

  return c.json(result);
});

// Route : Détail d'une boutique (ses produits et ses pubs)
shops.get('/:id', async (c) => {
  const sql = neon(c.env.DATABASE_URL);
  const id = c.req.param('id');

  // Infos de la boutique
  const shopInfo = await sql`
    SELECT * FROM shops WHERE id = ${id}
  `;

  // Ses produits uniques
  const products = await sql`
    SELECT DISTINCT ON (product_name)
      product_name,
      price,
      image_url,
      video_url,
      days_active,
      score
    FROM ads
    WHERE shop_id = ${id}
    ORDER BY product_name, score DESC
  `;

  // Ses meilleures pubs
  const adsList = await sql`
    SELECT 
      id, product_name, ad_text, image_url, video_url, 
      days_active, cta, destination_url, score
    FROM ads
    WHERE shop_id = ${id}
    ORDER BY score DESC, days_active DESC
    LIMIT 20
  `;

  return c.json({
    shop: shopInfo[0],
    products: products,
    ads: adsList
  });
});

export default shops;
