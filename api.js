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
  const now = new Date();
  // Use ET market date (approximate: if before 4pm ET, use previous day)
  const etHour = now.getUTCHours() - 5; // rough ET offset
  let d = new Date(now);
  if (etHour < 16) {
    // Before market close — "today's session" hasn't settled yet
    // Current OI in snapshot = yesterday's settled OI
  }
  return d.toISOString().split('T')[0];
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

  // Load previous cache
  let prevOiMap = {};
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      // Only use if from a previous date
      if (parsed.date && parsed.date !== today) {
        prevOiMap = parsed.oiMap || {};
      }
    }
  } catch (e) {
    // localStorage unavailable — no OI change
  }

  // Save today's OI for tomorrow's comparison
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      date: today,
      oiMap: todayOiMap,
    }));
  } catch (e) {
    // localStorage unavailable
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
