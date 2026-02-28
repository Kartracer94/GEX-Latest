// src/constants.js

export const CHART_TIMEFRAMES = [
  { label: '1Y', days: 365 },
  { label: '6M', days: 180 },
  { label: '90D', days: 90 },
  { label: '2M', days: 60 },
  { label: '1M', days: 30 },
  { label: '15D', days: 15 },
  { label: '5D', days: 5 },
];

export const CANDLE_TIMEFRAMES = [
  { label: 'Monthly', timespan: 'month', multiplier: 1, tvInterval: 'M' },
  { label: 'Weekly', timespan: 'week', multiplier: 1, tvInterval: 'W' },
  { label: 'Daily', timespan: 'day', multiplier: 1, tvInterval: 'D' },
  { label: 'Hourly', timespan: 'hour', multiplier: 1, tvInterval: '60' },
  { label: '15min', timespan: 'minute', multiplier: 15, tvInterval: '15' },
  { label: '5min', timespan: 'minute', multiplier: 5, tvInterval: '5' },
];
