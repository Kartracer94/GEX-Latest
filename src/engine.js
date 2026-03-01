// src/engine.js — Gamma Proxy Computation Engine
// Translated from ThinkScript Gamma Concentration Proxy Indicator
// Enhanced with: OI trend, IV spread, ATR moves, volume acceleration, multi-TF confirmation
// NEW: Gamma Exposure (GEX) computation by expiration bucket

/**
 * Compute gamma proxy values for each bar.
 * Input: array of OHLCV bars from Polygon ({ o, h, l, c, v, t })
 * Output: enriched array with gamma metrics per bar
 */
export function computeGammaProxy(bars, options = {}) {
  const {
    lookbackPeriod = 20,
    volumeThresholdMultiplier = 1.5,
    ivWeight = 0.4,
    volumeWeight = 0.6,
    smoothingLength = 5,
    atrPeriod = 14,
    volAccelBars = 4,
  } = options;

  if (!bars || bars.length < lookbackPeriod + smoothingLength) return null;

  const results = bars.map((bar, i) => {
    // ── Volume Analysis ──
    const lookbackStart = Math.max(0, i - lookbackPeriod + 1);
    const lookbackBars = bars.slice(lookbackStart, i + 1);
    const avgVol = lookbackBars.reduce((s, b) => s + b.v, 0) / lookbackBars.length;
    const volRatio = avgVol > 0 ? bar.v / avgVol : 1;
    const isHighVolume = volRatio >= volumeThresholdMultiplier;

    // ── Volume Acceleration ──
    // Check if vol ratio has been rising over the last N bars
    let volAcceleration = 0;
    let volAccelRising = false;
    if (i >= volAccelBars) {
      let risingCount = 0;
      const recentVolRatios = [];
      for (let j = i - volAccelBars; j <= i; j++) {
        const lb = bars.slice(Math.max(0, j - lookbackPeriod + 1), j + 1);
        const av = lb.reduce((s, b) => s + b.v, 0) / lb.length;
        recentVolRatios.push(av > 0 ? bars[j].v / av : 1);
      }
      for (let j = 1; j < recentVolRatios.length; j++) {
        if (recentVolRatios[j] > recentVolRatios[j - 1]) risingCount++;
      }
      // Acceleration = fraction of intervals that were rising (0 to 1)
      volAcceleration = risingCount / (recentVolRatios.length - 1);
      // Flag if at least 3 of 4 intervals are rising
      volAccelRising = risingCount >= volAccelBars - 1;
    }

    // ── ATR & Relative Move Size ──
    let atr = 0;
    let atrRatio = 1;
    if (i >= atrPeriod) {
      let atrSum = 0;
      for (let j = i - atrPeriod + 1; j <= i; j++) {
        const prevClose = j > 0 ? bars[j - 1].c : bars[j].o;
        const tr = Math.max(
          bars[j].h - bars[j].l,
          Math.abs(bars[j].h - prevClose),
          Math.abs(bars[j].l - prevClose)
        );
        atrSum += tr;
      }
      atr = atrSum / atrPeriod;
      const barRange = bar.h - bar.l;
      atrRatio = atr > 0 ? barRange / atr : 1;
    }
    const isLargeATRMove = atrRatio > 1.5;

    // ── Bid/Ask Pressure Proxy (using candle body position) ──
    const range = bar.h - bar.l;
    const bodyTop = Math.max(bar.o, bar.c);
    const bodyBottom = Math.min(bar.o, bar.c);
    const bodyMid = (bodyTop + bodyBottom) / 2;

    let bidAskPressure = 0;
    if (range > 0) {
      bidAskPressure = ((bodyMid - bar.l) / range - 0.5) * 2;
    }

    // ── Tick/Sweep Proxy ──
    let tickPressure = 0;
    let sweepBonus = 0;
    if (i >= 2) {
      const curr = bar;
      const prior = bars[i - 1];
      tickPressure = curr.c > prior.c ? 0.5 : curr.c < prior.c ? -0.5 : 0;

      const priorDippedBelow = prior.l < bars[i - 2].l;
      const priorPushedAbove = prior.h > bars[i - 2].h;
      const currClosesAbovePriorHigh = curr.c > prior.h;
      const currClosesBelowPriorLow = curr.c < prior.l;

      if (priorDippedBelow && currClosesAbovePriorHigh) {
        sweepBonus = 1;
      } else if (priorPushedAbove && currClosesBelowPriorLow) {
        sweepBonus = -1;
      }
    }

    const combinedPressure = bidAskPressure * 0.6 + tickPressure * 0.4 + sweepBonus * 0.4;

    // ── IV Percentile Proxy ──
    let ivPercentile = 0.5;
    let realizedVol = 0;
    if (lookbackBars.length >= 5) {
      const returns = [];
      for (let j = 1; j < lookbackBars.length; j++) {
        if (lookbackBars[j - 1].c > 0) {
          returns.push(Math.log(lookbackBars[j].c / lookbackBars[j - 1].c));
        }
      }
      if (returns.length > 0) {
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
        const currentVol = Math.sqrt(variance) * Math.sqrt(252);
        realizedVol = currentVol;

        const allVols = [];
        for (let k = lookbackPeriod; k <= i; k++) {
          const subBars = bars.slice(Math.max(0, k - lookbackPeriod + 1), k + 1);
          const subReturns = [];
          for (let j = 1; j < subBars.length; j++) {
            if (subBars[j - 1].c > 0) {
              subReturns.push(Math.log(subBars[j].c / subBars[j - 1].c));
            }
          }
          if (subReturns.length > 0) {
            const m = subReturns.reduce((a, b) => a + b, 0) / subReturns.length;
            const v = subReturns.reduce((s, r) => s + (r - m) ** 2, 0) / subReturns.length;
            allVols.push(Math.sqrt(v) * Math.sqrt(252));
          }
        }
        if (allVols.length > 0) {
          const minV = Math.min(...allVols);
          const maxV = Math.max(...allVols);
          const range = maxV - minV;
          ivPercentile = range > 0 ? (currentVol - minV) / range : 0.5;
        }
      }
    }

    // ── Gamma Concentration Proxy ──
    const ivComponent = ivPercentile;
    const volComponent = Math.min(volRatio / volumeThresholdMultiplier, 1);
    const gammaConcentration = ivComponent * ivWeight + volComponent * volumeWeight;

    return {
      ...bar,
      gammaConcentration,
      ivPercentile,
      volRatio,
      isHighVolume,
      combinedPressure,
      bidAskPressure,
      realizedVol,
      volAcceleration,
      volAccelRising,
      atr,
      atrRatio,
      isLargeATRMove,
    };
  });

  // ── Smoothing ──
  for (let i = smoothingLength; i < results.length; i++) {
    const window = results.slice(i - smoothingLength + 1, i + 1);
    const smoothed =
      window.reduce((s, r) => s + r.gammaConcentration, 0) / smoothingLength;
    results[i].gammaConcentration = smoothed;
  }

  // ── Derived flags ──
  for (let i = 2; i < results.length; i++) {
    const r = results[i];
    r.highGammaZone = r.gammaConcentration > 0.75 && r.isHighVolume;
    r.gammaExpanding =
      r.gammaConcentration > results[i - 1].gammaConcentration &&
        results[i - 1].gammaConcentration > results[i - 2].gammaConcentration;
  }

  return results;
}


/**
 * Analyze the options chain to extract OI trend and IV spread signals.
 * Returns a summary object used by generateSignal.
 * FIXED: oiChangeMap is now the actual change values (not raw previous OI)
 */
export function analyzeOptionsChain(optionsData, currentPrice, realizedVol, oiChangeMap) {
  if (!optionsData || optionsData.length === 0) {
    return null;
  }

  const calls = optionsData.filter((o) => o.details?.contract_type === 'call');
  const puts = optionsData.filter((o) => o.details?.contract_type === 'put');

  // ── Put/Call OI Ratio ──
  // < 0.7 = bullish (more call OI), > 1.0 = bearish (more put OI)
  const totalCallOI = calls.reduce((s, c) => s + (c.open_interest || 0), 0);
  const totalPutOI = puts.reduce((s, c) => s + (c.open_interest || 0), 0);
  const pcRatio = totalCallOI > 0 ? totalPutOI / totalCallOI : 1;

  // ── ATM IV vs Realized Vol Spread ──
  // Find near-the-money contracts (within 3% of current price)
  const nearMoney = optionsData.filter((o) => {
    const strike = o.details?.strike_price;
    return strike && Math.abs(strike - currentPrice) / currentPrice <= 0.03;
  });

  let avgATMIV = 0;
  let ivSpread = 0;    // positive = IV > realized (market expects bigger move)
  let ivSpreadRatio = 1;
  if (nearMoney.length > 0) {
    const ivValues = nearMoney
      .map((o) => o.implied_volatility)
      .filter((v) => v != null && v > 0);
    if (ivValues.length > 0) {
      avgATMIV = ivValues.reduce((a, b) => a + b, 0) / ivValues.length;
      if (realizedVol > 0) {
        ivSpread = avgATMIV - realizedVol;
        ivSpreadRatio = avgATMIV / realizedVol;
      }
    }
  }

  // ── OI Change Trend (near the money) ──
  // Rising call OI near the money = bullish squeeze building
  // Rising put OI near the money = bearish pressure building
  let callOiChanging = 0;
  let putOiChanging = 0;
  let netOiSignal = 0; // positive = bullish, negative = bearish

  if (oiChangeMap && Object.keys(oiChangeMap).length > 0) {
    // FIXED: oiChangeMap now contains actual change values directly
    const nearCalls = calls.filter((c) => {
      const strike = c.details?.strike_price;
      return strike && strike >= currentPrice * 0.95 && strike <= currentPrice * 1.10;
    });
    const nearPuts = puts.filter((c) => {
      const strike = c.details?.strike_price;
      return strike && strike >= currentPrice * 0.90 && strike <= currentPrice * 1.05;
    });

    for (const c of nearCalls) {
      const ticker = c.details?.ticker;
      if (ticker && oiChangeMap[ticker] != null) {
        callOiChanging += oiChangeMap[ticker];
      }
    }
    for (const p of nearPuts) {
      const ticker = p.details?.ticker;
      if (ticker && oiChangeMap[ticker] != null) {
        putOiChanging += oiChangeMap[ticker];
      }
    }

    // Net signal: positive call OI growth minus positive put OI growth
    // Normalized against total OI so it scales across different stocks
    const totalNearOI = totalCallOI + totalPutOI;
    if (totalNearOI > 0) {
      netOiSignal = (callOiChanging - putOiChanging) / Math.max(totalNearOI * 0.01, 1);
    }
  }

  return {
    pcRatio,
    totalCallOI,
    totalPutOI,
    avgATMIV,
    ivSpread,
    ivSpreadRatio,
    callOiChanging,
    putOiChanging,
    netOiSignal,
    hasOiChangeData: oiChangeMap && Object.keys(oiChangeMap).length > 0,
  };
}


// ═══════════════════════════════════════════════════════════════
//  NEW: Gamma Exposure (GEX) Computation
// ═══════════════════════════════════════════════════════════════

/**
 * Get the next N Fridays from a given date (for expiration bucketing).
 */
function getNextFridays(fromDate, count) {
  const fridays = [];
  const d = new Date(fromDate);
  // Move to next Friday
  const dayOfWeek = d.getDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7;
  d.setDate(d.getDate() + (dayOfWeek <= 5 && dayOfWeek > 0 ? (5 - dayOfWeek) : daysUntilFriday));

  // If today is Friday and before market close, include today
  const today = new Date(fromDate);
  if (today.getDay() === 5) {
    d.setDate(today.getDate());
  }

  for (let i = 0; i < count; i++) {
    fridays.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() + 7);
  }
  return fridays;
}

/**
 * Compute Gamma Exposure (GEX) from options chain data.
 *
 * GEX per contract = Gamma × OI × 100 × SpotPrice²
 * Calls = positive GEX (dealers long gamma → stabilizing)
 * Puts  = negative GEX (dealers short gamma → amplifying)
 *
 * Returns: {
 *   netGEX,              // total net GEX across all contracts
 *   callGEX,             // total call GEX
 *   putGEX,              // total put GEX
 *   normalizedGEX,       // -1 to +1 scale for gauge display
 *   zeroGammaLevel,      // strike where net GEX flips sign
 *   maxGammaStrike,      // strike with highest absolute GEX
 *   byExpiration: {      // GEX grouped by expiration bucket
 *     thisWeek: { netGEX, maxStrike, maxGEX, contracts },
 *     nextWeek: { netGEX, maxStrike, maxGEX, contracts },
 *     twoWeeksOut: { netGEX, maxStrike, maxGEX, contracts },
 *   },
 *   byStrike: [...]      // per-strike GEX for detailed analysis
 * }
 */
export function computeGEX(optionsData, spotPrice) {
  if (!optionsData || optionsData.length === 0 || !spotPrice || spotPrice <= 0) {
    return null;
  }

  // Filter to contracts that have valid gamma and OI
  const validContracts = optionsData.filter(
    (o) => o.greeks?.gamma != null && o.greeks.gamma > 0 && o.open_interest > 0
  );

  if (validContracts.length === 0) return null;

  const spotPriceSq = spotPrice * spotPrice;

  // ── Compute per-contract GEX ──
  const contractGEX = validContracts.map((o) => {
    const gamma = o.greeks.gamma;
    const oi = o.open_interest;
    const isCall = o.details?.contract_type === 'call';
    const sign = isCall ? 1 : -1;
    const gex = sign * gamma * oi * 100 * spotPriceSq;

    return {
      ticker: o.details?.ticker,
      strike: o.details?.strike_price,
      type: o.details?.contract_type,
      expiration: o.details?.expiration_date,
      gamma,
      oi,
      gex,
      iv: o.implied_volatility,
      delta: o.greeks?.delta,
    };
  });

  // ── Aggregate totals ──
  let callGEX = 0;
  let putGEX = 0;
  for (const c of contractGEX) {
    if (c.type === 'call') callGEX += c.gex;
    else putGEX += c.gex;
  }
  const netGEX = callGEX + putGEX;

  // ── Normalize to -1 to +1 scale ──
  const totalAbsGEX = Math.abs(callGEX) + Math.abs(putGEX);
  const normalizedGEX = totalAbsGEX > 0 ? netGEX / totalAbsGEX : 0;

  // ── Per-strike aggregation ──
  const strikeMap = {};
  for (const c of contractGEX) {
    const s = c.strike;
    if (!strikeMap[s]) {
      strikeMap[s] = { strike: s, callGEX: 0, putGEX: 0, netGEX: 0, totalOI: 0 };
    }
    if (c.type === 'call') {
      strikeMap[s].callGEX += c.gex;
    } else {
      strikeMap[s].putGEX += c.gex;
    }
    strikeMap[s].netGEX += c.gex;
    strikeMap[s].totalOI += c.oi;
  }

  const byStrike = Object.values(strikeMap).sort((a, b) => a.strike - b.strike);

  // ── Find zero-gamma level (where cumulative GEX flips sign) ──
  let zeroGammaLevel = spotPrice;
  let prevCumGEX = 0;
  for (const s of byStrike) {
    const cumGEX = prevCumGEX + s.netGEX;
    if (prevCumGEX !== 0 && Math.sign(cumGEX) !== Math.sign(prevCumGEX)) {
      // Linear interpolation between this strike and previous
      const prevStrike = byStrike[byStrike.indexOf(s) - 1]?.strike || s.strike;
      const ratio = Math.abs(prevCumGEX) / (Math.abs(prevCumGEX) + Math.abs(s.netGEX));
      zeroGammaLevel = prevStrike + (s.strike - prevStrike) * ratio;
      break;
    }
    prevCumGEX = cumGEX;
  }

  // ── Max gamma strike ──
  let maxGammaStrike = spotPrice;
  let maxAbsGEX = 0;
  for (const s of byStrike) {
    if (Math.abs(s.netGEX) > maxAbsGEX) {
      maxAbsGEX = Math.abs(s.netGEX);
      maxGammaStrike = s.strike;
    }
  }

  // ── Expiration buckets ──
  const fridays = getNextFridays(new Date(), 3);
  const thisWeekEnd = fridays[0];
  const nextWeekEnd = fridays[1];
  const twoWeeksEnd = fridays[2];

  function computeBucket(contracts) {
    if (contracts.length === 0) {
      return { netGEX: 0, maxStrike: null, maxGEX: 0, contracts: 0, callGEX: 0, putGEX: 0 };
    }
    let bCallGEX = 0, bPutGEX = 0;
    let bMaxStrike = null, bMaxGEX = 0;
    for (const c of contracts) {
      if (c.type === 'call') bCallGEX += c.gex;
      else bPutGEX += c.gex;
      if (Math.abs(c.gex) > Math.abs(bMaxGEX)) {
        bMaxGEX = c.gex;
        bMaxStrike = c.strike;
      }
    }
    return {
      netGEX: bCallGEX + bPutGEX,
      callGEX: bCallGEX,
      putGEX: bPutGEX,
      maxStrike: bMaxStrike,
      maxGEX: bMaxGEX,
      contracts: contracts.length,
    };
  }

  const thisWeekContracts = contractGEX.filter((c) => c.expiration && c.expiration <= thisWeekEnd);
  const nextWeekContracts = contractGEX.filter(
    (c) => c.expiration && c.expiration > thisWeekEnd && c.expiration <= nextWeekEnd
  );
  const twoWeeksContracts = contractGEX.filter(
    (c) => c.expiration && c.expiration > nextWeekEnd && c.expiration <= twoWeeksEnd
  );

  return {
    netGEX,
    callGEX,
    putGEX,
    normalizedGEX,
    zeroGammaLevel,
    maxGammaStrike,
    spotPrice,
    byExpiration: {
      thisWeek: computeBucket(thisWeekContracts),
      nextWeek: computeBucket(nextWeekContracts),
      twoWeeksOut: computeBucket(twoWeeksContracts),
    },
    byStrike,
    expirationDates: { thisWeekEnd, nextWeekEnd, twoWeeksEnd },
  };
}


/**
 * Run multi-timeframe confirmation.
 * Takes the current (primary) timeframe's gammaResults,
 * plus an optional higher-timeframe gammaResults array.
 * Returns alignment info used in signal scoring.
 */
export function multiTimeframeCheck(primaryResults, htfResults) {
  if (!primaryResults || primaryResults.length < 3) {
    return { aligned: false, htfAvailable: false, htfDirection: 'UNKNOWN' };
  }

  if (!htfResults || htfResults.length < 3) {
    return { aligned: false, htfAvailable: false, htfDirection: 'UNKNOWN' };
  }

  const pLatest = primaryResults[primaryResults.length - 1];
  const pPrev = primaryResults[primaryResults.length - 2];

  const hLatest = htfResults[htfResults.length - 1];
  const hPrev = htfResults[htfResults.length - 2];
  const hPrev2 = htfResults[htfResults.length - 3];

  // Determine HTF trend direction
  const htfPriceRising = hLatest.c > hPrev.c && hPrev.c > hPrev2.c;
  const htfPriceFalling = hLatest.c < hPrev.c && hPrev.c < hPrev2.c;
  const htfGammaRising = hLatest.gammaConcentration > hPrev.gammaConcentration;
  const htfPressureBullish = hLatest.combinedPressure > 0.1;
  const htfPressureBearish = hLatest.combinedPressure < -0.1;

  let htfDirection = 'NEUTRAL';
  if ((htfPriceRising || htfGammaRising) && htfPressureBullish) {
    htfDirection = 'BULLISH';
  } else if ((htfPriceFalling || !htfGammaRising) && htfPressureBearish) {
    htfDirection = 'BEARISH';
  }

  // Determine primary TF lean
  const pBullish = pLatest.combinedPressure > 0 && pLatest.c > pPrev.c;
  const pBearish = pLatest.combinedPressure < 0 && pLatest.c < pPrev.c;

  let primaryDirection = 'NEUTRAL';
  if (pBullish) primaryDirection = 'BULLISH';
  if (pBearish) primaryDirection = 'BEARISH';

  const aligned = htfDirection !== 'NEUTRAL' && htfDirection === primaryDirection;

  return {
    aligned,
    htfAvailable: true,
    htfDirection,
    primaryDirection,
    htfGammaConcentration: hLatest.gammaConcentration,
    htfPressure: hLatest.combinedPressure,
    htfVolRatio: hLatest.volRatio,
  };
}


/**
 * Generate a trading signal from gamma results + options chain data.
 * Returns direction, confidence %, reasoning, and strike recommendations.
 *
 * Enhanced params:
 *  - htfResults: higher-timeframe gamma results for multi-TF confirmation
 *  - oiChangeMap: day-over-day OI change map from api.js (FIXED: now actual change values)
 *  - gexData: computed GEX data for gamma exposure integration
 */
export function generateSignal(gammaResults, optionsData, oiChangeMap = null, htfResults = null, gexData = null) {
  if (!gammaResults || gammaResults.length < 3) return null;

  const latest = gammaResults[gammaResults.length - 1];
  const prev = gammaResults[gammaResults.length - 2];
  const prev2 = gammaResults[gammaResults.length - 3];

  const gammaRising =
    latest.gammaConcentration > prev.gammaConcentration &&
    prev.gammaConcentration > prev2.gammaConcentration;
  const gammaFalling =
    latest.gammaConcentration < prev.gammaConcentration &&
    prev.gammaConcentration < prev2.gammaConcentration;
  const priceRising = latest.c > prev.c && prev.c > prev2.c;
  const priceFalling = latest.c < prev.c && prev.c < prev2.c;

  // ── Analyze options chain ──
  const optionsAnalysis = analyzeOptionsChain(
    optionsData,
    latest.c,
    latest.realizedVol || 0,
    oiChangeMap
  );

  // ── Multi-timeframe check ──
  const mtf = multiTimeframeCheck(gammaResults, htfResults);

  // ══════════════════════════════════════════
  //  BULLISH SCORING
  // ══════════════════════════════════════════
  let bullScore = 0;
  let bullReasons = [];

  // --- Existing signals ---
  if (latest.gammaConcentration > 0.75) {
    bullScore += 20;
    bullReasons.push('High gamma concentration (>0.75)');
  }
  if (gammaRising) {
    bullScore += 15;
    bullReasons.push('Gamma expanding over 3 periods');
  }
  if (latest.combinedPressure > 0.2) {
    bullScore += 15;
    bullReasons.push('Ask-side pressure dominant (buying)');
  }
  if (latest.isHighVolume) {
    bullScore += 10;
    bullReasons.push('Volume above 1.5× average');
  }
  if (priceRising) {
    bullScore += 20;
    bullReasons.push('Price trending upward');
  }
  if (latest.ivPercentile > 0.7) {
    bullScore += 10;
    bullReasons.push('IV elevated — options actively traded');
  }

  // --- Volume Acceleration ---
  if (latest.volAccelRising && latest.isHighVolume) {
    bullScore += 10;
    bullReasons.push(`Volume accelerating over 4 bars (${(latest.volAcceleration * 100).toFixed(0)}% rising)`);
  }

  // --- ATR Breakout Move ---
  if (latest.isLargeATRMove && latest.combinedPressure > 0) {
    bullScore += 12;
    bullReasons.push(`Large bullish move (${latest.atrRatio.toFixed(1)}× ATR)`);
  }

  // --- Options Chain — OI Change Trend ---
  if (optionsAnalysis) {
    if (optionsAnalysis.hasOiChangeData && optionsAnalysis.netOiSignal > 1) {
      bullScore += 12;
      bullReasons.push(`Call OI building near money (+${optionsAnalysis.callOiChanging.toLocaleString()} net call OI change)`);
    }
    if (optionsAnalysis.pcRatio < 0.7) {
      bullScore += 8;
      bullReasons.push(`Low P/C ratio (${optionsAnalysis.pcRatio.toFixed(2)}) — call-heavy positioning`);
    }
  }

  // --- Options Chain — IV vs Realized Vol Spread ---
  if (optionsAnalysis && optionsAnalysis.avgATMIV > 0) {
    if (optionsAnalysis.ivSpreadRatio > 1.3) {
      bullScore += 10;
      bullReasons.push(`IV/RV spread elevated (${optionsAnalysis.ivSpreadRatio.toFixed(1)}×) — market pricing a move`);
    }
  }

  // --- Multi-Timeframe Confirmation ---
  if (mtf.htfAvailable && mtf.aligned && mtf.htfDirection === 'BULLISH') {
    bullScore += 15;
    bullReasons.push('Higher timeframe confirms bullish (trend + pressure aligned)');
  }

  // --- NEW: GEX Integration ---
  if (gexData) {
    // Negative GEX = dealers short gamma = squeeze potential (amplifies moves)
    if (gexData.normalizedGEX < -0.3 && priceRising) {
      bullScore += 15;
      bullReasons.push(`Dealers short gamma (GEX: ${formatGEX(gexData.netGEX)}) — squeeze amplification likely`);
    }
    // Price above zero-gamma level = bullish gamma territory
    if (latest.c > gexData.zeroGammaLevel) {
      bullScore += 8;
      bullReasons.push(`Price above zero-gamma level ($${gexData.zeroGammaLevel.toFixed(0)}) — positive gamma territory`);
    }
    // This week's GEX heavily negative = imminent squeeze risk
    if (gexData.byExpiration.thisWeek.netGEX < 0 && gexData.byExpiration.thisWeek.contracts > 5) {
      bullScore += 10;
      bullReasons.push(`This week expiry GEX negative (${formatGEX(gexData.byExpiration.thisWeek.netGEX)}) — near-term squeeze setup`);
    }
  }

  // ══════════════════════════════════════════
  //  BEARISH SCORING
  // ══════════════════════════════════════════
  let bearScore = 0;
  let bearReasons = [];

  // --- Existing signals ---
  if (latest.gammaConcentration < 0.25) {
    bearScore += 20;
    bearReasons.push('Low gamma concentration (<0.25)');
  }
  if (gammaFalling) {
    bearScore += 15;
    bearReasons.push('Gamma contracting over 3 periods');
  }
  if (latest.combinedPressure < -0.2) {
    bearScore += 15;
    bearReasons.push('Bid-side pressure dominant (selling)');
  }
  if (priceFalling) {
    bearScore += 20;
    bearReasons.push('Price trending downward');
  }
  if (latest.isHighVolume && priceFalling) {
    bearScore += 10;
    bearReasons.push('High volume on decline');
  }

  // --- Volume Acceleration ---
  if (latest.volAccelRising && latest.isHighVolume && priceFalling) {
    bearScore += 10;
    bearReasons.push(`Volume accelerating on decline (${(latest.volAcceleration * 100).toFixed(0)}% rising)`);
  }

  // --- ATR Breakout Move ---
  if (latest.isLargeATRMove && latest.combinedPressure < 0) {
    bearScore += 12;
    bearReasons.push(`Large bearish move (${latest.atrRatio.toFixed(1)}× ATR)`);
  }

  // --- Options Chain — OI Change Trend ---
  if (optionsAnalysis) {
    if (optionsAnalysis.hasOiChangeData && optionsAnalysis.netOiSignal < -1) {
      bearScore += 12;
      bearReasons.push(`Put OI building near money (+${optionsAnalysis.putOiChanging.toLocaleString()} net put OI change)`);
    }
    if (optionsAnalysis.pcRatio > 1.2) {
      bearScore += 8;
      bearReasons.push(`High P/C ratio (${optionsAnalysis.pcRatio.toFixed(2)}) — put-heavy positioning`);
    }
  }

  // --- Options Chain — IV vs Realized Vol Spread ---
  if (optionsAnalysis && optionsAnalysis.avgATMIV > 0) {
    if (optionsAnalysis.ivSpreadRatio > 1.3 && priceFalling) {
      bearScore += 10;
      bearReasons.push(`IV/RV spread elevated on decline (${optionsAnalysis.ivSpreadRatio.toFixed(1)}×) — downside priced in`);
    }
  }

  // --- Multi-Timeframe Confirmation ---
  if (mtf.htfAvailable && mtf.aligned && mtf.htfDirection === 'BEARISH') {
    bearScore += 15;
    bearReasons.push('Higher timeframe confirms bearish (trend + pressure aligned)');
  }

  // --- NEW: GEX Integration ---
  if (gexData) {
    // Negative GEX on declining price = amplified selling
    if (gexData.normalizedGEX < -0.3 && priceFalling) {
      bearScore += 15;
      bearReasons.push(`Dealers short gamma (GEX: ${formatGEX(gexData.netGEX)}) — selling amplified`);
    }
    // Price below zero-gamma level = negative gamma territory
    if (latest.c < gexData.zeroGammaLevel) {
      bearScore += 8;
      bearReasons.push(`Price below zero-gamma level ($${gexData.zeroGammaLevel.toFixed(0)}) — negative gamma territory`);
    }
    // Strongly positive GEX with high gamma = price pinning (low conviction)
    if (gexData.normalizedGEX > 0.5 && latest.gammaConcentration > 0.75) {
      bearScore += 5;
      bearReasons.push('High positive GEX — price may be pinned near max gamma strike');
    }
  }

  // ══════════════════════════════════════════
  //  DETERMINE DIRECTION
  // ══════════════════════════════════════════
  let direction = 'NEUTRAL';
  let confidence = 0;
  let reasoning = [];

  if (bullScore > bearScore && bullScore >= 30) {
    direction = 'BULLISH';
    confidence = bullScore;
    reasoning = bullReasons;
  } else if (bearScore > bullScore && bearScore >= 30) {
    direction = 'BEARISH';
    confidence = bearScore;
    reasoning = bearReasons;
  } else {
    confidence = Math.max(bullScore, bearScore);
    reasoning = bullScore >= bearScore ? bullReasons : bearReasons;
    if (reasoning.length === 0) {
      reasoning = ['Insufficient directional conviction'];
    }
  }

  // ── Strike recommendations ──
  const currentPrice = latest.c;
  let strikes = [];

  if (optionsData && optionsData.length > 0) {
    const calls = optionsData.filter((o) => o.details?.contract_type === 'call');
    const puts = optionsData.filter((o) => o.details?.contract_type === 'put');
    const sortByGamma = (a, b) => (b.greeks?.gamma || 0) - (a.greeks?.gamma || 0);

    const mapContract = (c) => ({
      strike: c.details.strike_price,
      type: c.details.contract_type.toUpperCase(),
      gamma: c.greeks?.gamma || 0,
      delta: c.greeks?.delta || 0,
      iv: c.implied_volatility || 0,
      bid: c.last_quote?.bid || 0,
      ask: c.last_quote?.ask || 0,
      openInterest: c.open_interest || 0,
      volume: c.day?.volume || 0,
      // FIXED: Use oiChangeMap values directly (they are already the change)
      oiChange: oiChangeMap?.[c.details.ticker] != null
        ? oiChangeMap[c.details.ticker]
        : null,
      expiration: c.details.expiration_date,
      ticker: c.details.ticker,
    });

    if (direction === 'BULLISH') {
      strikes = calls
        .filter((c) => c.details.strike_price >= currentPrice * 0.97)
        .sort(sortByGamma)
        .slice(0, 5)
        .map(mapContract);
    } else if (direction === 'BEARISH') {
      strikes = puts
        .filter((c) => c.details.strike_price <= currentPrice * 1.03)
        .sort(sortByGamma)
        .slice(0, 5)
        .map(mapContract);
    } else {
      strikes = optionsData
        .filter((o) => o.greeks?.gamma > 0)
        .sort(sortByGamma)
        .slice(0, 5)
        .map(mapContract);
    }

    // ── NEW: Enhance strike recommendations with GEX data ──
    if (gexData && strikes.length > 0) {
      // Add GEX context to each recommended strike
      for (const s of strikes) {
        const strikeGEX = gexData.byStrike.find((gs) => gs.strike === s.strike);
        s.strikeGEX = strikeGEX ? strikeGEX.netGEX : 0;
        s.gexSignal = strikeGEX
          ? (strikeGEX.netGEX > 0 ? 'SUPPORT' : 'RESISTANCE')
          : 'NEUTRAL';
      }

      // Sort by combination of gamma and favorable GEX
      strikes.sort((a, b) => {
        // Prefer strikes where GEX aligns with direction
        const aGEXBonus = direction === 'BULLISH'
          ? (a.strikeGEX < 0 ? 0.3 : 0) // Negative GEX = squeeze potential for bulls
          : (a.strikeGEX > 0 ? 0.3 : 0); // Positive GEX = pinning for bears
        const bGEXBonus = direction === 'BULLISH'
          ? (b.strikeGEX < 0 ? 0.3 : 0)
          : (b.strikeGEX > 0 ? 0.3 : 0);
        return (b.gamma + bGEXBonus) - (a.gamma + aGEXBonus);
      });
    }
  } else {
    // Synthetic fallback
    const roundTo = currentPrice > 100 ? 5 : currentPrice > 20 ? 2.5 : 1;
    const baseStrike = Math.round(currentPrice / roundTo) * roundTo;

    if (direction === 'BULLISH') {
      strikes = [
        { strike: baseStrike, type: 'CALL', synthetic: true },
        { strike: baseStrike + roundTo, type: 'CALL', synthetic: true },
        { strike: baseStrike + roundTo * 2, type: 'CALL', synthetic: true },
      ];
    } else if (direction === 'BEARISH') {
      strikes = [
        { strike: baseStrike, type: 'PUT', synthetic: true },
        { strike: baseStrike - roundTo, type: 'PUT', synthetic: true },
        { strike: baseStrike - roundTo * 2, type: 'PUT', synthetic: true },
      ];
    } else {
      strikes = [
        { strike: baseStrike, type: 'CALL', synthetic: true },
        { strike: baseStrike, type: 'PUT', synthetic: true },
      ];
    }
  }

  return {
    direction,
    confidence: Math.min(confidence, 100),
    reasoning,
    strikes,
    metrics: {
      gammaProxy: latest.gammaConcentration,
      ivPercentile: latest.ivPercentile,
      pressure: latest.combinedPressure,
      volRatio: latest.volRatio,
      volAcceleration: latest.volAcceleration,
      atrRatio: latest.atrRatio,
      price: currentPrice,
    },
    // Expose new analysis for UI display
    optionsAnalysis,
    multiTimeframe: mtf,
    gexData,
  };
}


/**
 * Format GEX value for display (in billions/millions)
 */
function formatGEX(value) {
  if (value == null) return 'N/A';
  const abs = Math.abs(value);
  const sign = value >= 0 ? '+' : '-';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// Export for use in App.jsx
export { formatGEX };
