// /api/bars.js — Vercel Serverless Function
// Proxies OHLCV requests to Polygon.io, keeping the API key server-side

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { ticker, multiplier, timespan, from, to } = req.query;

  if (!ticker || !multiplier || !timespan || !from || !to) {
    return res.status(400).json({
      error: 'Missing required parameters: ticker, multiplier, timespan, from, to',
    });
  }

  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'POLYGON_API_KEY not configured' });
  }

  try {
    // Free tier: intraday data (minute/hour) may be delayed or unavailable.
    // If intraday fails, we'll suggest switching to daily/weekly.
    const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(
      ticker
    )}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=50000&apiKey=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    // Forward Polygon's rate limit headers so the client can react
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    if (rateLimitRemaining) {
      res.setHeader('X-RateLimit-Remaining', rateLimitRemaining);
    }

    // Handle free tier rate limiting (5 req/min)
    if (response.status === 429) {
      return res.status(429).json({
        error: 'Rate limit reached (free tier: 5 requests/min). Please wait a moment and try again.',
        status: 'ERROR',
      });
    }

    // Handle auth errors
    if (response.status === 401 || response.status === 403) {
      return res.status(response.status).json({
        error: 'API key invalid or unauthorized. Check your POLYGON_API_KEY.',
        status: 'ERROR',
      });
    }

    // If Polygon returns OK but no results, provide a helpful message
    if ((data.status === 'OK' || data.status === 'DELAYED') && (!data.results || data.results.length === 0)) {
      const isIntraday = timespan === 'minute' || timespan === 'hour';
      return res.status(200).json({
        ...data,
        resultsCount: 0,
        results: [],
        _hint: isIntraday
          ? 'Free tier may not support intraday data. Try Daily or Weekly candles with a longer date range (90D+).'
          : 'No data found for this ticker/range. Try a longer date range.',
      });
    }

    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Polygon bars fetch error:', error);
    return res.status(502).json({ error: 'Failed to fetch data from Polygon.io' });
  }
}
