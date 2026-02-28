# Gamma App

Real-time options analysis dashboard powered by Polygon.io. Displays OHLCV charts, options chain data, Gamma Exposure (GEX) analysis, and actionable trade signals for any ticker.

## Live Demo

Deployed on Vercel: `gamma-app` (Hobby tier)

**Repository**: [github.com/Kartracer94/GEX-Latest](https://github.com/Kartracer94/GEX-Latest)

## Features

- **OHLCV Candlestick Charts** — Multiple timeframes (1D, 5D, 1M, 3M, 6M, 1Y) with configurable candle intervals
- **Options Chain Analysis** — Fetches full options snapshots via Polygon.io, displays strikes with greeks, OI, volume, and IV
- **Gamma Exposure (GEX)** — Per-contract GEX calculation with weekly bucketing:
  - This Week / Next Week / 2 Weeks Out expiration breakdowns
  - Net GEX, Call GEX, Put GEX per bucket
  - Max Gamma Strike identification per period
  - Zero-Gamma Level (strike where cumulative net GEX flips sign)
- **Day-over-Day OI Change** — Tracks open interest changes using localStorage caching (no paid API tier required)
- **Trade Signal Engine** — Generates Bull/Bear/Neutral signals with confidence scoring based on:
  - Put/Call ratio analysis
  - IV skew detection
  - OI change momentum
  - GEX positioning (squeeze amplification, price pinning, gamma flip proximity)
- **Strike Recommendations** — Suggested strikes for calls/puts with GEX alignment scoring
- **Gauge Metrics** — Visual gauges for Net GEX positioning and Gamma Flip Distance

## Tech Stack

- **Frontend**: React + Vite
- **Styling**: Custom CSS (no framework)
- **Backend**: Vercel Serverless Functions (API proxy layer)
- **Data**: Polygon.io REST API (Options Starter tier or higher)
- **Deployment**: Vercel

## Project Structure

```
gamma-app/
├── api/
│   ├── bars.js          # Serverless function — proxies OHLCV bar data from Polygon.io
│   └── options.js       # Serverless function — proxies options snapshot data from Polygon.io
├── src/
│   ├── App.jsx          # Main React component — UI, state management, GEX panel, gauges
│   ├── api.js           # Client-side data layer — fetch helpers, OI change tracking (localStorage)
│   ├── engine.js        # Analysis engine — GEX computation, signal generation, strike recommendations
│   ├── constants.js     # Chart/candle timeframe configuration
│   ├── styles.css       # All application styles
│   └── main.jsx         # React entry point
├── index.html           # Vite HTML entry
├── package.json         # Dependencies and scripts
├── vite.config.js       # Vite configuration
├── vercel.json          # Vercel routing and function config
└── .env.example         # Environment variable template
```

## Setup

### Prerequisites

- Node.js 18+
- A [Polygon.io](https://polygon.io) API key (Options Starter tier or higher for options data)

### Local Development

```bash
# Install dependencies
npm install

# Create .env file with your Polygon API key
cp .env.example .env
# Edit .env and add: POLYGON_API_KEY=your_key_here

# Start dev server
npm run dev
```

The app runs at `http://localhost:5173` by default.

### Environment Variables

| Variable | Description |
|---|---|
| `POLYGON_API_KEY` | Your Polygon.io API key (required) |

Set this in Vercel under Project Settings → Environment Variables for production.

## Deployment

This project auto-deploys to Vercel on every push to `main` via the GitHub integration.

### Quick Deploy (push to GitHub)

```bash
git add -A && git commit -m "your message" && git push origin main
```

Vercel will automatically build and deploy within ~30 seconds.

### First-Time Setup

```bash
git clone https://github.com/Kartracer94/GEX-Latest.git
cd GEX-Latest
npm install
```

### Updating Source Files

```bash
# Copy updated files into the correct directories
cp ~/path/to/updated/App.jsx src/App.jsx
cp ~/path/to/updated/api.js src/api.js
cp ~/path/to/updated/engine.js src/engine.js
cp ~/path/to/updated/styles.css src/styles.css
cp ~/path/to/updated/constants.js src/constants.js

# Push to deploy
git add -A && git commit -m "Update src files" && git push origin main
```

## Key Modules

### `engine.js` — Analysis Engine

**`computeGEX(optionsData, spotPrice)`**
Calculates Gamma Exposure across the full options chain:
- Formula: `GEX = ±1 × gamma × OI × 100 × spotPrice²` (positive for calls, negative for puts)
- Aggregates by strike price and expiration bucket (this week, next week, 2 weeks out)
- Finds the zero-gamma level where net GEX flips sign
- Returns normalized GEX score (-1 to +1) for gauge display

**`generateSignal(analysis, ticker, price, prevDayOiMap, gexData)`**
Produces a trade signal (BULLISH / BEARISH / NEUTRAL) with confidence percentage. Scoring factors include P/C ratio, IV skew, high-OI strike clustering, OI change momentum, and GEX positioning.

**`analyzeOptionsChain(options, spotPrice, oiChangeMap)`**
Maps raw Polygon.io snapshot data into structured contract objects with computed metrics (moneyness, distance from spot, OI change).

### `api.js` — Data Layer

**`computeOiChangeMap(ticker, currentOptions)`**
Tracks day-over-day open interest changes using browser localStorage. Returns `{ changeMap, rawPrevOiMap }` — the change map contains deltas, the raw map contains previous absolute values.

### `App.jsx` — UI

Main React component with:
- Ticker input and timeframe selectors
- TradingView-style candlestick chart (canvas-rendered)
- GEX Panel with 3-column weekly breakdown
- Signal display with bull/bear scoring
- Options strikes table with sortable columns including GEX per strike
- Gauge row: Net GEX gauge and Gamma Flip Distance gauge

## Recent Changes

### GEX Integration (Latest)
- Added full Gamma Exposure computation pipeline
- Weekly GEX bucketing (this week / next week / 2 weeks out)
- Zero-Gamma Level calculation
- GEX-informed signal scoring (squeeze amplification, gamma flip proximity, price pinning)
- Replaced IV Percentile gauge with Net GEX gauge
- Replaced Vol Ratio gauge with Gamma Flip Distance gauge
- Added GEX column to strikes table
- Enhanced strike recommendations with GEX alignment

### OI Change Fix
- Fixed double-delta bug where OI change was computed twice (once in `computeOiChangeMap`, then again in `mapContract`)
- `computeOiChangeMap` now returns both the change map and raw previous OI map
- `mapContract` uses change values directly instead of re-subtracting

## Polygon.io API Endpoints Used

- **Bars**: `GET /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}`
- **Options Snapshot**: `GET /v3/snapshot/options/{underlyingTicker}`

Both are proxied through Vercel serverless functions in `api/` to keep the API key server-side.

## License

Private project.
