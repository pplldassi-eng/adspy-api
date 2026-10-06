import { neon } from '@neondatabase/serverless';
import fs from 'fs';

const DATABASE_URL = process.env.DATABASE_URL!;
const WORKER_AI_URL = process.env.WORKER_AI_URL!;
const WORKER_AI_KEY = process.env.WORKER_AI_KEY!;

const sql = neon(DATABASE_URL);

interface Classification {
  product_name: string;
  category: string;
  price: number | null;
}

async function classifyAd(ad: any): Promise<Classification | null> {
  const text = (ad.ad_text || '').slice(0, 1500);
  const advertiser = ad.advertiser || '';
  
  const prompt = `Analyse cette publicité e-commerce africaine (modèle COD - paiement à la livraison).

Annonceur : ${advertiser}
Texte publicitaire :
"""
${text}
"""

Retourne UNIQUEMENT un objet JSON valide, sans texte autour, avec exactement ces 3 champs :
{
  "product_name": "Nom court du produit en 5 mots max (ex: Blender SilverCrest 8500W)",
  "category": "Une seule catégorie parmi : Cuisine, Beauté, Santé, Mode, Maison, Électronique, Sport, Enfant, Alimentaire, Bijoux, Auto, Autre",
  "price": 13000
}

Si le prix n'est pas visible, mets null pour price.
Ne mets AUCUN commentaire. Uniquement le JSON.`;

  try {
    const res = await fetch(WORKER_AI_URL + '/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WORKER_AI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        systemPrompt: "Tu es un expert en e-commerce africain. Tu retournes uniquement du JSON valide, sans texte autour.",
        max_tokens: 300,
      }),
    });

    if (!res.ok) {
      console.error(`Worker AI error ${res.status}`);
      return null;
    }

    const data: any = await res.json();
    console.log('DEBUG raw response:', JSON.stringify(data).slice(0, 200));
    let raw = data.response;
    if (typeof raw === 'object' && raw !== null) {
      raw = raw.response || raw.text || raw.content || JSON.stringify(raw);
    }
    let content = String(raw || '').trim();
    content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    
    const parsed = JSON.parse(match[0]);
    return {
      product_name: String(parsed.product_name || '').slice(0, 200),
      category: String(parsed.category || 'Autre'),
      price: typeof parsed.price === 'number' ? parsed.price : null,
    };
  } catch (e) {
    console.error(`Classify error:`, e);
    return null;
  }
}

function normalizeProductKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}

async function main() {
  console.log('📥 Chargement des annonces depuis Neon...');
  const ads = await sql`SELECT * FROM ads ORDER BY score DESC`;
  console.log(`✅ ${ads.length} annonces chargées`);

  console.log('🧹 Nettoyage de la table products...');
  await sql`DELETE FROM product_ads`;
  await sql`DELETE FROM products`;

  const groups = new Map<string, {
    product_name: string;
    category: string;
    price_min: number | null;
    price_max: number | null;
    shops: Set<string>;
    ads: number[];
    max_days: number;
    max_score: number;
    countries: Set<string>;
    keywords: Set<string>;
    sample_ad_id: string;
  }>();

  let processed = 0;
  for (const ad of ads) {
    processed++;
    console.log(`\n[${processed}/${ads.length}] ${ad.advertiser}`);
    
    const classification = await classifyAd(ad);
    if (!classification || !classification.product_name) {
      console.log(`  ⏭️  Skipped (classification échouée)`);
      continue;
    }

    const key = normalizeProductKey(classification.product_name);
    console.log(`  → ${classification.product_name} (${classification.category})`);

    if (!groups.has(key)) {
      groups.set(key, {
        product_name: classification.product_name,
        category: classification.category,
        price_min: classification.price,
        price_max: classification.price,
        shops: new Set(),
        ads: [],
        max_days: 0,
        max_score: 0,
        countries: new Set(),
        keywords: new Set(),
        sample_ad_id: ad.library_id,
      });
    }

    const g = groups.get(key)!;
    g.ads.push(ad.id);
    if (ad.advertiser) g.shops.add(ad.advertiser);
    if (ad.country) g.countries.add(ad.country);
    if (ad.keyword) g.keywords.add(ad.keyword);
    if (ad.days_active && ad.days_active > g.max_days) g.max_days = ad.days_active;
    if (ad.score && ad.score > g.max_score) g.max_score = ad.score;
    
    const price = ad.price || classification.price;
    if (price) {
      if (!g.price_min || price < g.price_min) g.price_min = price;
      if (!g.price_max || price > g.price_max) g.price_max = price;
    }
  }

  console.log(`\n📦 ${groups.size} produits uniques à insérer`);

  for (const [key, g] of groups) {
    const shopsCount = g.shops.size;
    const adsCount = g.ads.length;

    let productScore = g.max_score;
    if (shopsCount >= 3) productScore += 15;
    if (shopsCount >= 5) productScore += 10;
    if (g.max_days >= 60) productScore += 20;
    if (g.max_days >= 120) productScore += 15;

    const result = await sql`
      INSERT INTO products (
        product_name, category, price_min, price_max,
        shops_count, ads_count, max_days_active, avg_score,
        product_score, countries, keywords, sample_ad_id
      ) VALUES (
        ${g.product_name}, ${g.category}, ${g.price_min}, ${g.price_max},
        ${shopsCount}, ${adsCount}, ${g.max_days}, ${g.max_score},
        ${productScore}, ${Array.from(g.countries)}, ${Array.from(g.keywords)}, ${g.sample_ad_id}
      )
      RETURNING id
    `;

    const productId = result[0].id;
    for (const adId of g.ads) {
      await sql`INSERT INTO product_ads (product_id, ad_id) VALUES (${productId}, ${adId}) ON CONFLICT DO NOTHING`;
    }

    console.log(`💾 ${g.product_name} — score ${productScore} — ${shopsCount} boutiques`);
  }

  console.log(`\n✅ Terminé. ${groups.size} produits créés.`);
}

main().catch((e) => {
  console.error('❌ Erreur fatale:', e);
  process.exit(1);
});
