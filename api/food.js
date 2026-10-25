// Vercel serverless function: searches real food databases for Cutline.
// Optional environment variables: USDA_API_KEY (free at fdc.nal.usda.gov/api-key-signup), ANTHROPIC_API_KEY.
const UA = 'Cutline/1.0 (sports nutrition tracker)';
const HEB = /[\u0590-\u05ff]/;
const nut = (arr) => {
  const g = (ids) => { for (const x of arr) if (ids.includes(x.nutrientId)) return x.value == null ? null : x.value; return null; };
  return { kcal: g([1008, 2047, 2048]), p: g([1003]), c: g([1005]), f: g([1004]), sat: g([1258]), fib: g([1079]), na: g([1093]), k: g([1092]), s: g([2000, 1063]) };
};
const v = (x) => (x == null || x === '' ? null : +x);

async function claude(key, model, prompt, max) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: max, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json();
  return (j.content || []).map((c) => c.text || '').join('').trim();
}

async function usda(query, state) {
  const key = process.env.USDA_API_KEY || 'DEMO_KEY';
  const q = (query + ' ' + (state === 'cooked' ? 'cooked' : state === 'raw' ? 'raw' : '')).trim();
  const r = await fetch('https://api.nal.usda.gov/fdc/v1/foods/search?query=' + encodeURIComponent(q) + '&pageSize=8&api_key=' + key, { headers: { 'User-Agent': UA } });
  const j = await r.json();
  return (j.foods || []).map((x) => ({ name: x.description, brand: x.brandOwner || x.brandName || '', src: 'USDA ' + x.dataType, per: nut(x.foodNutrients || []) }));
}

async function off(term) {
  const r = await fetch('https://world.openfoodfacts.org/cgi/search.pl?search_terms=' + encodeURIComponent(term) + '&search_simple=1&action=process&json=1&page_size=6&fields=product_name,brands,nutriments,nova_group', { headers: { 'User-Agent': UA } });
  const j = await r.json();
  return (j.products || []).filter((p) => p.nutriments && p.nutriments['energy-kcal_100g'] != null).map((p) => {
    const n = p.nutriments;
    return {
      name: p.product_name || term, brand: p.brands || '', src: 'Open Food Facts', nova: p.nova_group,
      per: { kcal: v(n['energy-kcal_100g']), p: v(n.proteins_100g), c: v(n.carbohydrates_100g), f: v(n.fat_100g), sat: v(n['saturated-fat_100g']), fib: v(n.fiber_100g),
        na: n.sodium_100g != null ? n.sodium_100g * 1000 : (n.salt_100g != null ? (n.salt_100g / 2.5) * 1000 : null), k: n.potassium_100g != null ? n.potassium_100g * 1000 : null, s: v(n.sugars_100g) }
    };
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { q, brand, state } = req.body || {};
  if (!q || typeof q !== 'string' || q.length > 120) return res.status(400).json({ error: 'Bad query' });
  const key = process.env.ANTHROPIC_API_KEY;
  const out = [];
  let note = '';
  try {
    let en = q;
    if (HEB.test(q) && key) {
      en = (await claude(key, 'claude-haiku-4-5-20251001', 'Translate this food name from Hebrew to English for a food database search. In Israeli products "ביו" means probiotic (bio) yogurt. Keep any brand name transliterated. Reply with the English words only, no punctuation, no explanation: ' + q, 40)) || q;
    }
    const jobs = [usda((brand ? brand + ' ' : '') + en, state).catch(() => []), off(((brand || '') + ' ' + q).trim()).catch(() => [])];
    if (en !== q) jobs.push(off(((brand || '') + ' ' + en).trim()).catch(() => []));
    (await Promise.all(jobs)).forEach((a) => out.push(...a));
    if (!out.length && key) {
      const t = await claude(key, 'claude-sonnet-5-5', 'Give typical nutrition values per 100 g for this food: "' + q + (brand ? ' (' + brand + ')' : '') + '", ' + (state === 'cooked' ? 'cooked' : state === 'raw' ? 'raw' : 'as eaten') + '. Return ONLY JSON with numeric keys kcal, p, c, f, sat, fib, na (sodium in mg), s. Use null if unknown.', 200);
      const m = t.match(/\{[\s\S]*\}/);
      if (m) { const o = JSON.parse(m[0]); out.push({ name: q, brand: brand || '', src: 'AI estimate (please check)', per: { kcal: o.kcal, p: o.p, c: o.c, f: o.f, sat: o.sat, fib: o.fib, na: o.na, k: null, s: o.s } }); note = 'No database match. The values are an AI estimate. Please check them.'; }
    }
  } catch (e) { note = 'Food search had a problem.'; }
  return res.status(200).json({ results: out.slice(0, 14), note });
};
