// Vercel serverless function: reads a nutrition label photo with Claude.
// Needs the environment variable ANTHROPIC_API_KEY in your Vercel project settings.
const PROMPT = `This is a photo of a food package. Read the nutrition facts table (Hebrew or English) and the ingredient list if it is visible.
Return ONLY a JSON object with these keys:
name (product name or null), brand (company or null),
basis ("per100g" or "perServing"), servingG (grams or ml per serving, number or null),
kcal, p (protein g), f (fat g), sat (saturated fat g), c (carbohydrates g), s (sugars g), fib (dietary fiber g),
na (sodium in mg. If only salt is shown, use salt in g divided by 2.5, times 1000),
ingredients (the ingredient list as one string, or null).
Use null for any value you cannot read clearly. Never guess. Prefer the per 100 g column when both are shown.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server is not configured' });
  const { image, media } = req.body || {};
  if (!image || typeof image !== 'string' || image.length > 4000000) return res.status(400).json({ error: 'Bad image' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 700,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: media || 'image/jpeg', data: image } },
          { type: 'text', text: PROMPT }
        ] }]
      })
    });
    const j = await r.json();
    const text = (j.content || []).map(c => c.text || '').join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: 'No result' });
    const o = JSON.parse(m[0]);
    if (o.basis === 'perServing' && o.servingG > 0) {
      const f = 100 / o.servingG;
      ['kcal', 'p', 'f', 'sat', 'c', 'fib', 's', 'na'].forEach(k => { if (typeof o[k] === 'number') o[k] = Math.round(o[k] * f * 10) / 10; });
      o.basis = 'per100g';
    }
    return res.status(200).json(o);
  } catch (e) {
    return res.status(502).json({ error: 'Scan failed' });
  }
};
