import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchBars, fetchOptionsChain, getDateRange, computeOiChangeMap } from './api.js';
import { computeGammaProxy, generateSignal, analyzeOptionsChain, multiTimeframeCheck, computeGEX, formatGEX } from './engine.js';
import { CHART_TIMEFRAMES, CANDLE_TIMEFRAMES } from './constants.js';

// ── TradingView Widget ──
function TradingViewChart({ symbol, interval }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    container.innerHTML = '';

    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container';
    widgetDiv.style.height = '100%';
    widgetDiv.style.width = '100%';

    const innerDiv = document.createElement('div');
    innerDiv.className = 'tradingview-widget-container__widget';
    innerDiv.style.height = '100%';
    innerDiv.style.width = '100%';
    widgetDiv.appendChild(innerDiv);

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src =
      'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: 'America/New_York',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: 'rgba(10, 10, 15, 1)',
      gridColor: 'rgba(30, 35, 50, 0.4)',
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: 'https://www.tradingview.com',
    });

    widgetDiv.appendChild(script);
    container.appendChild(widgetDiv);

    return () => {
      container.innerHTML = '';
    };
  }, [symbol, interval]);

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />;
}

// ── Gauge Components ──
function GammaGauge({ value, label, min = 0, max = 1, colorScheme = 'default' }) {
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const angle = -90 + pct * 180;

  let color;
  if (colorScheme === 'gex') {
    // Red (negative/short gamma) → Yellow (neutral) → Green (positive/long gamma)
    color = pct < 0.4 ? '#ff4466' : pct < 0.6 ? '#ffaa00' : '#00ff88';
  } else if (colorScheme === 'pressure') {
    color = pct < 0.35 ? '#ff4466' : pct > 0.65 ? '#00ff88' : '#ffaa00';
  } else {
    color = pct < 0.3 ? '#00ff88' : pct < 0.7 ? '#ffaa00' : '#ff4466';
  }

  const id = `gauge-${label.replace(/\s/g, '')}`;

  return (
    <div className="gauge">
      <svg width={100} height={60} style={{ display: 'block' }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${60} ${50} ${60},${100},${60}`} fill={`url(#${id})`} />
        <polyline points={50} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <div className="gauge-label">{label}</div>
      <div className="gauge-value" style={{ color }}>
        {typeof value === 'number' ? value.toFixed(2) : value}
      </div>
    </div>
  );
}

function SparkLine({ data, width = 600, height = 28, color = '#00aaff' }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`)
    .join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block', opacity: 0.6 }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// ── GEX Weekly Panel Component ──
function GEXPanel({ gexData }) {
  if (!gexData) return null;

  const buckets = [
    { label: 'This Week', key: 'thisWeek', date: gexData.expirationDates?.thisWeekEnd },
    { label: 'Next Week', key: 'nextWeek', date: gexData.expirationDates?.nextWeekEnd },
    { label: '2 Weeks Out', key: 'twoWeeksOut', date: gexData.expirationDates?.twoWeeksEnd },
  ];

  return (
    <div style={{ marginTop: '12px' }}>
      <div className="section-subtitle">GAMMA EXPOSURE (GEX) BY EXPIRATION</div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '8px',
        fontSize: '11px',
        fontFamily: 'var(--font-mono)',
      }}>
        {buckets.map((bucket) => {
          const data = gexData.byExpiration[bucket.key];
          const hasData = data && data.contracts > 0;
          const netColor = !hasData ? '#555'
            : data.netGEX > 0 ? '#00ff88'
            : data.netGEX < 0 ? '#ff4466'
            : '#aab';

          return (
            <div key={bucket.key} style={{
              padding: '10px',
              background: 'rgba(255,255,255,0.02)',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ color: '#888', marginBottom: '6px', fontSize: '10px', textTransform: 'uppercase' }}>
                {bucket.label}
              </div>
              <div style={{ color: '#aab', fontSize: '9px', marginBottom: '4px' }}>
                Exp: {bucket.date || 'N/A'}
              </div>
              {hasData ? (
                <>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: netColor, marginBottom: '4px' }}>
                    {formatGEX(data.netGEX)}
                  </div>
                  <div style={{ color: '#666', fontSize: '9px' }}>
                    <span style={{ color: '#00ff88' }}>C: {formatGEX(data.callGEX)}</span>
                    {' / '}
                    <span style={{ color: '#ff4466' }}>P: {formatGEX(data.putGEX)}</span>
                  </div>
                  {data.maxStrike && (
                    <div style={{ color: '#888', fontSize: '9px', marginTop: '4px' }}>
                      Max γ strike: ${data.maxStrike >= 10 ? data.maxStrike.toFixed(0) : data.maxStrike.toFixed(2)}
                    </div>
                  )}
                  <div style={{ color: '#555', fontSize: '9px' }}>
                    {data.contracts} contracts
                  </div>
                </>
              ) : (
                <div style={{ color: '#555', fontSize: '11px' }}>No data</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Zero Gamma & Max Gamma Summary */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px',
        marginTop: '8px',
        fontSize: '11px',
        fontFamily: 'var(--font-mono)',
      }}>
        <div style={{
          padding: '8px',
          background: 'rgba(255,255,255,0.02)',
          borderRadius: '6px',
        }}>
          <div style={{ color: '#888', fontSize: '10px' }}>ZERO GAMMA LEVEL</div>
          <div style={{
            fontSize: '16px',
            fontWeight: 700,
            color: gexData.spotPrice > gexData.zeroGammaLevel ? '#00ff88' : '#ff4466',
          }}>
            ${gexData.zeroGammaLevel?.toFixed(2)}
          </div>
          <div style={{ color: '#555', fontSize: '9px' }}>
            Price {gexData.spotPrice > gexData.zeroGammaLevel ? 'above' : 'below'} →{' '}
            {gexData.spotPrice > gexData.zeroGammaLevel ? 'positive γ zone' : 'negative γ zone'}
          </div>
        </div>
        <div style={{
          padding: '8px',
          background: 'rgba(255,255,255,0.02)',
          borderRadius: '6px',
        }}>
          <div style={{ color: '#888', fontSize: '10px' }}>NET GEX</div>
          <div style={{
            fontSize: '16px',
            fontWeight: 700,
            color: gexData.netGEX > 0 ? '#00ff88' : '#ff4466',
          }}>
            {formatGEX(gexData.netGEX)}
          </div>
          <div style={{ color: '#555', fontSize: '9px' }}>
            {gexData.normalizedGEX > 0.3
              ? 'Dealers long γ — price stabilizing'
              : gexData.normalizedGEX < -0.3
              ? 'Dealers short γ — moves amplified'
              : 'Near-neutral gamma positioning'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──
export default function App() {
  const [ticker, setTicker] = useState('AAPL');
  const [tickerInput, setTickerInput] = useState('AAPL');
  const [chartTimeframe, setChartTimeframe] = useState(CHART_TIMEFRAMES[3]);
  const [candleTimeframe, setCandleTimeframe] = useState(CANDLE_TIMEFRAMES[2]);

  const [bars, setBars] = useState([]);
  const [optionsData, setOptionsData] = useState([]);
  const [gammaResults, setGammaResults] = useState(null);
  const [signal, setSignal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [htfResults, setHtfResults] = useState(null);
  const [htfLoading, setHtfLoading] = useState(false);

  // Ref to break circular dependency: loadOptions needs gammaResults but must not depend on it
  const gammaResultsRef = useRef(null);

  // Keep ref in sync so loadOptions can read latest gammaResults without depending on it
  useEffect(() => { gammaResultsRef.current = gammaResults; }, [gammaResults]);

  // Map each candle timeframe to its higher-timeframe counterpart for multi-TF confirmation
  const HTF_MAP = {
    '5min':   { multiplier: 1, timespan: 'hour', label: 'Hourly' },
    '15min':  { multiplier: 1, timespan: 'hour', label: 'Hourly' },
    'hourly': { multiplier: 1, timespan: 'day', label: 'Daily' },
    'daily':  { multiplier: 1, timespan: 'week', label: 'Weekly' },
    'weekly': { multiplier: 1, timespan: 'month', label: 'Monthly' },
    'monthly': null, // no higher TF available
  };

  // ── Fetch OHLCV ──
  const loadBars = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { from, to } = getDateRange(chartTimeframe.days);
      const data = await fetchBars(
        ticker,
        candleTimeframe.multiplier,
        candleTimeframe.timespan,
        from,
        to
      );
      const results = data.results || [];
      setBars(results);
      if (results.length > 0) {
        const gammaData = computeGammaProxy(results);
        setGammaResults(gammaData);
      } else {
        setGammaResults(null);
      }
    } catch (e) {
      console.error('Bars fetch error:', e);
      setError(e.message);
      setBars([]);
      setGammaResults(null);
    }
    setLoading(false);
  }, [ticker, chartTimeframe, candleTimeframe]);

  // ── Fetch HTF ──
  const loadHTF = useCallback(async () => {
    const htfConfig = HTF_MAP[candleTimeframe.label.toLowerCase()];
    if (!htfConfig) {
      setHtfResults(null);
      return;
    }
    setHtfLoading(true);
    try {
      const { from, to } = getDateRange(chartTimeframe.days * 2);
      const data = await fetchBars(
        ticker,
        htfConfig.multiplier,
        htfConfig.timespan,
        from,
        to
      );
      const results = data.results || [];
      if (results.length > 0) {
        setHtfResults(computeGammaProxy(results));
      } else {
        setHtfResults(null);
      }
    } catch (e) {
      console.error('HTF fetch error:', e);
      setHtfResults(null);
    }
    setHtfLoading(false);
  }, [ticker, chartTimeframe, candleTimeframe]);

  const [optionsHint, setOptionsHint] = useState(null);
  const [oiChangeData, setOiChangeData] = useState(null);
  const [gexData, setGexData] = useState(null);

  // ── Fetch Options ──
  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    setOptionsHint(null);
    try {
      const data = await fetchOptionsChain(ticker);
      const results = data.results || [];
      setOptionsData(results);
      if (data._hint) {
        setOptionsHint(data._hint);
      }
      // Compute OI change map from localStorage cache
      // FIXED: Now returns { changeMap, rawPrevOiMap } separately
      if (results.length > 0) {
        const { changeMap } = computeOiChangeMap(ticker, results);
        setOiChangeData(Object.keys(changeMap).length > 0 ? changeMap : null);

        // NEW: Compute GEX from options data
        const currentPrice = gammaResultsRef.current?.[gammaResultsRef.current.length - 1]?.c;
        if (currentPrice) {
          const gex = computeGEX(results, currentPrice);
          setGexData(gex);
        }
      } else {
        setOiChangeData(null);
        setGexData(null);
      }
    } catch (e) {
      console.error('Options fetch error:', e);
      setOptionsData([]);
      setOiChangeData(null);
      setGexData(null);
    }
    setOptionsLoading(false);
  }, [ticker]);

  useEffect(() => {
    loadBars();
    loadOptions();
    loadHTF();
  }, [loadBars, loadOptions, loadHTF]);

  // Recompute GEX when gammaResults update (price dependency)
  useEffect(() => {
    if (optionsData.length > 0 && gammaResults && gammaResults.length > 0) {
      const currentPrice = gammaResults[gammaResults.length - 1].c;
      const gex = computeGEX(optionsData, currentPrice);
      setGexData(gex);
    }
  }, [gammaResults, optionsData]);

  useEffect(() => {
    if (gammaResults && gammaResults.length > 3) {
      // FIXED: Pass oiChangeData (actual change values) instead of raw previous OI
      setSignal(generateSignal(gammaResults, optionsData, oiChangeData, htfResults, gexData));
    }
  }, [gammaResults, optionsData, oiChangeData, htfResults, gexData]);

  const handleTickerSubmit = (e) => {
    e?.preventDefault?.();
    setTicker(tickerInput.toUpperCase().trim());
  };

  const latest = gammaResults?.[gammaResults.length - 1];
  const pressureHistory = gammaResults
    ? gammaResults.slice(-60).map((r) => r.combinedPressure)
    : [];

  return (
    <div className="app">
      <header>
        <div className="header-left">
          <h1>
            <span className="logo-gamma">GAMMA</span>{' '}
            <span className="logo-squeeze">SQUEEZE</span>{' '}
            <span className="logo-detector">DETECTOR</span>
          </h1>
          <form onSubmit={handleTickerSubmit} className="ticker-form">
            <input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              placeholder="TICKER"
              className="ticker-input"
            />
            <button type="submit" className="ticker-btn">
              Analyze
            </button>
          </form>
        </div>

        <div className="tf-selector">
          {CANDLE_TIMEFRAMES.map((tf) => (
            <button
              key={tf.label}
              className={`tf-btn ${candleTimeframe.label === tf.label ? 'tf-btn--active-blue' : ''}`}
              onClick={() => setCandleTimeframe(tf)}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Live Badge */}
        {signal && (
          <div className={`signal-badge signal-badge--${signal.direction.toLowerCase()}`}>
            <div className="signal-dot" />
            <span className="signal-dir">{signal.direction}</span>
            <span className="signal-conf">{signal.confidence}%</span>
          </div>
        )}
      </header>

      {/* ── CHART ── */}
      <div className="chart-container">
        {loading && (
          <div className="chart-loading">
            <div className="spinner" />
            <div className="spinner-text">Loading {ticker}...</div>
          </div>
        )}
        <TradingViewChart symbol={ticker} interval={candleTimeframe.tvInterval} />
      </div>

      {/* ── INDICATOR PANEL ── */}
      <div className="indicator-panel">
        {error && <div className="error-bar">⚠ {error}</div>}

        {/* Gauges — UPDATED: replaced IV Percentile and Vol Ratio with GEX metrics */}
        {latest && (
          <div className="gauge-row">
            <div className="gauge-cell">
              <GammaGauge value={latest.gammaConcentration} label="Gamma Proxy" />
            </div>
            <div className="gauge-cell">
              <GammaGauge
                value={gexData ? gexData.normalizedGEX : 0}
                label="Net GEX"
                min={-1}
                max={1}
                colorScheme="gex"
              />
            </div>
            <div className="gauge-cell">
              <GammaGauge
                value={latest.combinedPressure}
                label="Bid/Ask Pressure"
                min={-1}
                max={1}
                colorScheme="pressure"
              />
            </div>
            <div className="gauge-cell">
              <GammaGauge
                value={gexData ? (latest.c - gexData.zeroGammaLevel) / latest.c : 0}
                label="γ Flip Dist"
                min={-0.05}
                max={0.05}
                colorScheme="gex"
              />
            </div>
          </div>
        )}

        {/* Signal + Strikes */}
        {signal && (
          <div className="signal-grid">
            {/* Signal Card */}
            <div className="signal-card">
              <div className="section-title">SIGNAL ANALYSIS</div>
              <div className="signal-header">
                <div className={`signal-icon signal-icon--${signal.direction.toLowerCase()}`}>
                  {signal.direction === 'BULLISH' ? '↑' : signal.direction === 'BEARISH' ? '↓' : '→'}
                </div>
                <div>
                  <div className={`signal-direction signal-direction--${signal.direction.toLowerCase()}`}>
                    {signal.direction}
                  </div>
                  <div className="signal-confidence">
                    Confidence: <span>{signal.confidence}%</span>
                  </div>
                </div>
              </div>

              <div className="section-subtitle">REASONING</div>
              {signal.reasoning.map((r, i) => (
                <div key={i} className="reason-item">
                  <span className={`reason-dot reason-dot--${signal.direction.toLowerCase()}`}>●</span>
                  {r}
                </div>
              ))}

              <div className="price-box">
                <span className="price-label">Current Price</span>
                <span className="price-value">${signal.metrics?.price?.toFixed(2)}</span>
              </div>

              {/* Options Analysis Summary */}
              {signal.optionsAnalysis && (
                <div style={{ marginTop: '12px' }}>
                  <div className="section-subtitle">OPTIONS FLOW</div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 1fr',
                    gap: '8px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    <div style={{ padding: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                      <div style={{ color: '#556', marginBottom: '4px' }}>P/C OI Ratio</div>
                      <div style={{
                        color: signal.optionsAnalysis.pcRatio < 0.7 ? '#00ff88'
                          : signal.optionsAnalysis.pcRatio > 1.2 ? '#ff4466' : '#aab',
                        fontWeight: 600,
                      }}>
                        {signal.optionsAnalysis.pcRatio.toFixed(2)}
                      </div>
                    </div>
                    <div style={{ padding: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                      <div style={{ color: '#556', marginBottom: '4px' }}>P/C Vol Ratio</div>
                      <div style={{
                        color: signal.optionsAnalysis.pcVolumeRatio < 0.6 ? '#00ff88'
                          : signal.optionsAnalysis.pcVolumeRatio > 1.5 ? '#ff4466' : '#aab',
                        fontWeight: 600,
                      }}>
                        {signal.optionsAnalysis.pcVolumeRatio.toFixed(2)}
                      </div>
                    </div>
                    <div style={{ padding: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                      <div style={{ color: '#556', marginBottom: '4px' }}>IV/RV Spread</div>
                      <div style={{
                        color: signal.optionsAnalysis.ivSpreadRatio > 1.3 ? '#ffaa00' : '#aab',
                        fontWeight: 600,
                      }}>
                        {signal.optionsAnalysis.ivSpreadRatio.toFixed(2)}x
                      </div>
                    </div>
                    <div style={{ padding: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                      <div style={{ color: '#556', marginBottom: '4px' }}>IV Skew</div>
                      <div style={{
                        color: signal.optionsAnalysis.ivSkewRatio > 1.15 ? '#ff4466'
                          : signal.optionsAnalysis.ivSkewRatio < 1.05 && signal.optionsAnalysis.ivSkewRatio > 0
                            ? '#00ff88' : '#aab',
                        fontWeight: 600,
                      }}>
                        {signal.optionsAnalysis.ivSkewRatio > 0
                          ? `${signal.optionsAnalysis.ivSkewRatio.toFixed(2)}x`
                          : 'N/A'}
                      </div>
                      <div style={{ color: '#444', fontSize: '9px', marginTop: '2px' }}>
                        {signal.optionsAnalysis.ivSkewRatio > 1.15 ? 'put demand high'
                          : signal.optionsAnalysis.ivSkewRatio < 1.05 && signal.optionsAnalysis.ivSkewRatio > 0
                            ? 'skew flat/inverted' : 'normal'}
                      </div>
                    </div>
                    <div style={{ padding: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                      <div style={{ color: '#556', marginBottom: '4px' }}>Vanna</div>
                      <div style={{
                        color: signal.optionsAnalysis.normalizedVanna > 0.15 ? '#00ff88'
                          : signal.optionsAnalysis.normalizedVanna < -0.15 ? '#ff4466' : '#aab',
                        fontWeight: 600,
                      }}>
                        {signal.optionsAnalysis.normalizedVanna.toFixed(3)}
                      </div>
                      <div style={{ color: '#444', fontSize: '9px', marginTop: '2px' }}>
                        {signal.optionsAnalysis.normalizedVanna > 0.15 ? 'IV drop = buy pressure'
                          : signal.optionsAnalysis.normalizedVanna < -0.15 ? 'IV spike = sell pressure'
                            : 'neutral'}
                      </div>
                    </div>
                    <div style={{ padding: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                      <div style={{ color: '#556', marginBottom: '4px' }}>Vol/OI (NTM)</div>
                      <div style={{
                        color: signal.optionsAnalysis.nearMoneyVolOI > 0.5 ? '#ffaa00' : '#aab',
                        fontWeight: 600,
                      }}>
                        {signal.optionsAnalysis.nearMoneyVolOI.toFixed(2)}
                      </div>
                      <div style={{ color: '#444', fontSize: '9px', marginTop: '2px' }}>
                        {signal.optionsAnalysis.nearMoneyVolOI > 0.5 ? 'new positions' : 'stale OI'}
                      </div>
                    </div>
                  </div>

                  {/* Max Pain + GEX Panel */}
                  {signal.maxPainData && (
                    <div style={{
                      marginTop: '8px',
                      padding: '8px',
                      background: 'rgba(255,255,255,0.02)',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}>
                      <div>
                        <span style={{ color: '#556' }}>MAX PAIN </span>
                        <span style={{ color: '#ffaa00', fontWeight: 700, fontSize: '14px' }}>
                          ${signal.maxPainData.maxPainStrike.toFixed(signal.maxPainData.maxPainStrike >= 10 ? 0 : 2)}
                        </span>
                      </div>
                      <div style={{ color: '#666', fontSize: '10px' }}>
                        {signal.metrics?.price > signal.maxPainData.maxPainStrike
                          ? `Price $${(signal.metrics.price - signal.maxPainData.maxPainStrike).toFixed(2)} above`
                          : `Price $${(signal.maxPainData.maxPainStrike - signal.metrics.price).toFixed(2)} below`}
                        {' '}— {Math.abs(((signal.metrics.price - signal.maxPainData.maxPainStrike) / signal.metrics.price) * 100).toFixed(1)}% gap
                      </div>
                    </div>
                  )}

                  <GEXPanel gexData={gexData} />
                </div>
              )}

              {/* Options loading status */}
              <div style={{ marginTop: '8px', fontSize: '10px' }}>
                {optionsLoading ? (
                  <span className="status-dot">● Loading options...</span>
                ) : optionsData.length > 0 ? (
                  <span className="status-dot status-dot--loaded">● {optionsData.length} CONTRACTS</span>
                ) : null}
                {optionsHint && optionsData.length === 0 && !optionsLoading && (
                  <div className="strikes-notice strikes-notice--warn" style={{ marginBottom: '12px' }}>
                    {optionsHint}
                  </div>
                )}
              </div>
            </div>

            {/* Strikes Card */}
            <div className="signal-card">
              <div className="section-title">
                {signal.direction === 'BULLISH' ? 'RECOMMENDED CALLS' :
                 signal.direction === 'BEARISH' ? 'RECOMMENDED PUTS' :
                 'TOP GAMMA STRIKES'}
              </div>

              {signal.strikes.length > 0 ? (
                <div className="strikes-table">
                  {/* Header */}
                  <div className={`strikes-row strikes-row--header ${signal.strikes[0]?.synthetic ? 'strikes-row--synthetic' : ''}`}>
                    <span>Strike</span>
                    <span>Type</span>
                    {!signal.strikes[0]?.synthetic && (
                      <>
                        <span>Gamma</span>
                        <span>Delta</span>
                        <span>IV</span>
                        <span>OI</span>
                        <span>Volume</span>
                        <span>OI Chg</span>
                        <span>GEX</span>
                        <span>Bid</span>
                        <span>Ask</span>
                        <span>Expiry</span>
                      </>
                    )}
                  </div>

                  {signal.strikes.map((s, i) => (
                    <div
                      key={i}
                      className={`strikes-row ${s.synthetic ? 'strikes-row--synthetic' : ''} ${
                        i === 0 ? `strikes-row--top strikes-row--top-${signal.direction.toLowerCase()}` : ''
                      }`}
                    >
                      <span className="strike-price">${s.strike?.toFixed(s.strike >= 10 ? 0 : 2)}</span>
                      <span className={`strike-type strike-type--${s.type?.toLowerCase()}`}>{s.type}</span>
                      {!s.synthetic && (
                        <>
                          <span className="strike-data">{s.gamma?.toFixed(4)}</span>
                          <span className="strike-data">{s.delta?.toFixed(3)}</span>
                          <span className="strike-iv">{(s.iv * 100)?.toFixed(1)}%</span>
                          <span className="strike-oi">{s.openInterest?.toLocaleString()}</span>
                          <span className="strike-vol">{s.volume?.toLocaleString()}</span>
                          <span className={`strike-oi-chg ${
                            s.oiChange > 0 ? 'strike-oi-chg--up' :
                            s.oiChange < 0 ? 'strike-oi-chg--down' :
                            s.oiChange === 0 ? '' : 'strike-oi-chg--na'
                          }`}>
                            {s.oiChange != null
                              ? `${s.oiChange > 0 ? '+' : ''}${s.oiChange.toLocaleString()}`
                              : '—'}
                          </span>
                          <span className={`strike-gex ${
                            s.strikeGEX > 0 ? 'strike-gex--pos' :
                            s.strikeGEX < 0 ? 'strike-gex--neg' : ''
                          }`}>
                            {s.strikeGEX != null ? formatGEX(s.strikeGEX) : '—'}
                          </span>
                          <span className="strike-quote">${s.bid?.toFixed(2)}</span>
                          <span className="strike-quote">${s.ask?.toFixed(2)}</span>
                          <span className="strike-expiry">{s.expiration}</span>
                        </>
                      )}
                    </div>
                  ))}

                  {signal.strikes[0]?.synthetic && (
                    <div className="strikes-notice strikes-notice--warn">
                      △ Synthetic strikes — options chain data unavailable. Strikes are estimated from
                      price rounding. Upgrade your Polygon.io plan for real-time options data with Greeks.
                    </div>
                  )}

                  {!signal.strikes[0]?.synthetic && (
                    <div className="strikes-notice strikes-notice--info">
                      ★ Top recommendation highlighted — highest gamma concentration at strike relative to
                      current price. Higher gamma = stronger potential magnet effect.
                      {signal.strikes[0]?.gexSignal && (
                        <span style={{ display: 'block', marginTop: '4px', opacity: 0.8 }}>
                          GEX signal at top strike: {signal.strikes[0].gexSignal}
                          {signal.strikes[0].gexSignal === 'SUPPORT' ? ' (positive γ = price stabilizing)' : ' (negative γ = breakout potential)'}
                        </span>
                      )}
                      {signal.strikes[0]?.oiChange == null && (
                        <span style={{ display: 'block', marginTop: '4px', opacity: 0.7 }}>
                          OI Change will populate after your second session — data is cached locally for day-over-day comparison.
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="strikes-empty">No strike recommendations available. Waiting for data...</div>
              )}
            </div>

            {/* Metric Definitions */}
            {signal.optionsAnalysis && (
              <div className="signal-card" style={{ gridColumn: '1 / -1' }}>
                <div className="section-title">OPTIONS FLOW GLOSSARY</div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '12px 24px',
                  fontSize: '11px',
                  lineHeight: '1.5',
                  color: '#889',
                }}>
                  <div>
                    <div style={{ color: '#aab', fontWeight: 600, marginBottom: '2px' }}>P/C OI Ratio</div>
                    Total put open interest divided by total call open interest. Below 0.7 indicates heavy call positioning (bullish). Above 1.2 indicates heavy put positioning (bearish).
                  </div>
                  <div>
                    <div style={{ color: '#aab', fontWeight: 600, marginBottom: '2px' }}>P/C Volume Ratio</div>
                    Today's put volume divided by call volume. A leading indicator — today's volume becomes tomorrow's open interest. Below 0.6 signals aggressive call buying; above 1.5 signals aggressive put buying.
                  </div>
                  <div>
                    <div style={{ color: '#aab', fontWeight: 600, marginBottom: '2px' }}>IV/RV Spread</div>
                    Implied volatility divided by realized (historical) volatility. Above 1.3x means the options market is pricing in a larger move than the stock has recently made — often a precursor to a breakout or event.
                  </div>
                  <div>
                    <div style={{ color: '#aab', fontWeight: 600, marginBottom: '2px' }}>IV Skew</div>
                    Ratio of out-of-the-money put IV to out-of-the-money call IV. Above 1.15x means puts are significantly more expensive — institutions are buying downside protection (bearish). Below 1.05x means the skew is flat or inverted — low fear, often bullish.
                  </div>
                  <div>
                    <div style={{ color: '#aab', fontWeight: 600, marginBottom: '2px' }}>Vanna</div>
                    Measures how much dealers must buy or sell stock when implied volatility changes. Positive vanna means an IV drop forces dealers to buy shares (bullish). Negative vanna means an IV spike forces dealers to sell shares (bearish).
                  </div>
                  <div>
                    <div style={{ color: '#aab', fontWeight: 600, marginBottom: '2px' }}>Vol/OI (NTM)</div>
                    Today's volume divided by open interest for near-the-money contracts. Above 0.5 means new positions are being actively opened today. Below 0.5 means most open interest is stale — carried over from previous sessions.
                  </div>
                  <div>
                    <div style={{ color: '#aab', fontWeight: 600, marginBottom: '2px' }}>Max Pain</div>
                    The strike price where the most options expire worthless — maximizing losses for option buyers. Price tends to gravitate toward max pain into expiration, especially when dealers hold positive gamma and can pin the stock.
                  </div>
                  <div>
                    <div style={{ color: '#aab', fontWeight: 600, marginBottom: '2px' }}>GEX (Gamma Exposure)</div>
                    Net gamma exposure across all contracts. Positive GEX means dealers are long gamma — they buy dips and sell rips, stabilizing price. Negative GEX means dealers are short gamma — they must chase the move in both directions, amplifying volatility.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pressure Sparkline Footer */}
        {pressureHistory.length > 0 && (
          <div className="pressure-footer">
            <div className="pressure-label">BID/ASK PRESSURE</div>
            <SparkLine data={pressureHistory} width={600} height={28} color="#00aaff" />
            <div
              className="pressure-value"
              style={{
                color: latest.combinedPressure > 0.1
                  ? '#00ff88'
                  : latest.combinedPressure < -0.1
                  ? '#ff4466'
                  : '#aab',
              }}
            >
              {latest.combinedPressure.toFixed(3)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
