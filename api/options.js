// /api/options.js — Vercel Serverless Function
// Proxies options chain snapshot requests to Polygon.io

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { ticker, limit = 250 } = req.query;

  if (!ticker) {
    return res.status(400).json({ error: 'Missing required parameter: ticker' });
  }

  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'POLYGON_API_KEY not configured' });
  }

  try {
    const url = `https://api.polygon.io/v3/snapshot/options/${encodeURIComponent(
      ticker
    )}?limit=${limit}&apiKey=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    if (rateLimitRemaining) {
      res.setHeader('X-RateLimit-Remaining', rateLimitRemaining);
    }

    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Polygon options fetch error:', error);
    return res.status(502).json({ error: 'Failed to fetch options data from Polygon.io' });
  }
}
