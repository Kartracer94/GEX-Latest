// src/api.js — All API calls routed through /api/ serverless functions
// The Polygon API key never touches the browser

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

export function getDateRange(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { from: formatDate(start), to: formatDate(end) };
}

export async function fetchBars(ticker, multiplier, timespan, from, to) {
  const params = new URLSearchParams({ ticker, multiplier, timespan, from, to });
  const res = await fetch(`/api/bars?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchOptionsChain(ticker, limit = 250) {
  const params = new URLSearchParams({ ticker, limit: String(limit) });
  const res = await fetch(`/api/options?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── OI Change via localStorage caching ──
// Stores each day's OI snapshot locally; computes change vs previous session
// FIXED: Now returns BOTH the raw previous OI map AND the change map separately

const OI_STORAGE_KEY = 'gamma_oi_cache';

function getTradingDate() {
  // Get current date in US Eastern time (handles DST automatically)
  const now = new Date();
  const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const et = new Date(etString);
  return et.toISOString().split('T')[0];
}

function getPrevTradingDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setDate(d.getDate() - 1);
  // Skip weekends
  if (d.getDay() === 0) d.setDate(d.getDate() - 2);
  if (d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

/**
 * Compute OI change map AND return the raw previous OI map.
 * Returns { changeMap, rawPrevOiMap } so consumers can use the right one.
 */
export function computeOiChangeMap(ticker, currentOptions) {
  if (!currentOptions || currentOptions.length === 0) return { changeMap: {}, rawPrevOiMap: {} };

  const today = getTradingDate();
  const cacheKey = `${OI_STORAGE_KEY}_${ticker}`;

  // Build today's OI map from snapshot
  const todayOiMap = {};
  for (const c of currentOptions) {
    if (c.details?.ticker && c.open_interest != null) {
      todayOiMap[c.details.ticker] = c.open_interest;
    }
  }

  // Load previous cache and persist both current + previous day snapshots
  let prevOiMap = {};
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.date && parsed.date !== today) {
        // New trading day — rotate: today's cached snapshot becomes "prev"
        prevOiMap = parsed.oiMap || {};
        localStorage.setItem(cacheKey, JSON.stringify({
          date: today,
          oiMap: todayOiMap,
          prevDate: parsed.date,
          prevOiMap: prevOiMap,
        }));
      } else if (parsed.date === today && parsed.prevOiMap) {
        // Same day refresh — reuse the stored previous-day snapshot
        prevOiMap = parsed.prevOiMap;
        localStorage.setItem(cacheKey, JSON.stringify({
          date: today,
          oiMap: todayOiMap,
          prevDate: parsed.prevDate,
          prevOiMap: parsed.prevOiMap,
        }));
      } else {
        // Same day, no previous data (first-ever session)
        localStorage.setItem(cacheKey, JSON.stringify({
          date: today,
          oiMap: todayOiMap,
        }));
      }
    } else {
      // No cache at all — first session
      localStorage.setItem(cacheKey, JSON.stringify({
        date: today,
        oiMap: todayOiMap,
      }));
    }
  } catch (e) {
    // localStorage unavailable — no OI change
  }

  // Compute change map: { "O:AAPL...": +150, "O:AAPL...": -30 }
  const changeMap = {};
  if (Object.keys(prevOiMap).length > 0) {
    for (const [contractTicker, currentOi] of Object.entries(todayOiMap)) {
      if (prevOiMap[contractTicker] != null) {
        changeMap[contractTicker] = currentOi - prevOiMap[contractTicker];
      }
    }
  }

  return { changeMap, rawPrevOiMap: prevOiMap };
}
