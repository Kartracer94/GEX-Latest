# Γ Gamma Squeeze Detector

A real-time gamma squeeze probability indicator that analyzes stock price action, volume, implied volatility, and options chain data to generate buy/sell signals with specific strike price recommendations.

## Architecture

```
gamma-app/
├── api/                    # Vercel Serverless Functions (API key stays server-side)
│   ├── bars.js             # Proxies OHLCV data from Polygon.io
│   └── options.js          # Proxies options chain snapshots from Polygon.io
├── src/
│   ├── main.jsx            # React entry point
│   ├── App.jsx             # Main UI component
│   ├── api.js              # Frontend API client (calls /api/* routes)
│   ├── engine.js           # Gamma proxy computation engine (ThinkScript → JS)
│   ├── constants.js        # Timeframe configurations
│   └── styles.css          # All styling
├── index.html              # HTML entry
├── vite.config.js          # Vite build config
├── vercel.json             # Vercel deployment config
└── package.json
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure your API key

**For local development**, create a `.env.local` file:

```bash
cp .env.example .env.local
# Edit .env.local and set your Polygon.io API key
```

**For Vercel deployment**, set the environment variable in the Vercel dashboard:
- Go to your project → Settings → Environment Variables
- Add: `POLYGON_API_KEY` = `your_key_here`

### 3. Run locally

```bash
npm run dev
```

> **Note:** The serverless functions in `/api/` won't work with plain `vite dev`. To test locally with the API routes, use the Vercel CLI:
>
> ```bash
> npm i -g vercel
> vercel dev
> ```

### 4. Deploy to Vercel

```bash
# Push to GitHub, then connect the repo in Vercel dashboard
# Or deploy directly:
vercel --prod
```

## How It Works

### Gamma Proxy Engine

The engine translates ThinkScript gamma concentration logic to JavaScript:

1. **Volume Analysis** — Computes volume ratio vs 20-period average; flags high-volume bars
2. **Bid/Ask Pressure** — Uses bar close position (close near high = buying) and tick direction
3. **IV Percentile** — Approximates implied volatility percentile using realized volatility
4. **Gamma Proxy** — Weighted combination of IV percentile and volume ratio, adjusted by pressure
5. **Signal Generation** — Scores bullish/bearish conditions and outputs directional signal with confidence %

### Strike Recommendations

When options chain data is available (requires Polygon.io Options plan):
- Filters calls (bullish) or puts (bearish) near current price
- Sorts by gamma (highest gamma = strongest magnet effect)
- Shows gamma, delta, IV, bid/ask, and expiration for each contract

### Data Sources

- **Price Data:** Polygon.io Aggregates API (`/v2/aggs/ticker/...`)
- **Options Data:** Polygon.io Options Chain Snapshot (`/v3/snapshot/options/...`)
- **Charts:** TradingView Advanced Chart Widget (embedded)

## API Key Security

Your Polygon.io API key is **never exposed to the browser**. All API calls are proxied through Vercel Serverless Functions in the `/api/` directory. The key is read from `process.env.POLYGON_API_KEY` server-side only.

## Disclaimer

This is a proxy indicator — not a true GEX (Gamma Exposure) calculation. For educational purposes only. Not financial advice. Options trading involves significant risk of loss.
