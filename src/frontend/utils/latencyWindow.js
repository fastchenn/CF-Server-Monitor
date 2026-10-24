import { LATENCY_WINDOW } from './constants.js'
import { normalizeTimestamp } from './time.js'

const PROBE_KEYS = ['ct', 'cu', 'cm', 'bd', 'node_1', 'node_2', 'node_3', 'node_4']
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

export const getCurrentProbeMetric = (server, field, fallback = null) => {
  if (!server || !hasOwn(server, field) || server[field] === undefined) return fallback
  const value = server[field]
  if (value === null || value === '' || value === false || value === 'false') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

// Overlay reports onto the existing time buckets in browser memory. Historical
// queries keep their original cache and D1 cadence; live points need no polling.
export const mergeLiveLatencyWindow = (server, data, timestamp, config = {}) => {
  const sampleTs = normalizeTimestamp(timestamp)
  if (!sampleTs || !data) return {}
  const configuredPoints = Number(config?.points)
  const points = Number.isInteger(configuredPoints) && configuredPoints > 0
    ? Math.min(configuredPoints, 240)
    : LATENCY_WINDOW.POINTS
  const configuredHours = Number(config?.hours)
  const hours = Number.isFinite(configuredHours) && configuredHours > 0
    ? configuredHours
    : LATENCY_WINDOW.HOURS
  const result = {}

  for (const seriesName of ['ping', 'loss']) {
    const keys = PROBE_KEYS.filter(key => hasOwn(data, `${seriesName}_${key}`) && data[`${seriesName}_${key}`] !== undefined)
    if (keys.length === 0) continue

    const history = (Array.isArray(server?.[seriesName]) ? server[seriesName] : [])
      .map(point => ({ ...point, ts: normalizeTimestamp(point?.ts ?? point?.timestamp) }))
      .filter(point => point.ts)
      .sort((a, b) => a.ts - b.ts)
      .slice(-points)
    // D1's bucket width may include a rounding millisecond. Retain its actual
    // spacing so live overlays stay aligned with cached historical buckets.
    const historyInterval = history.length > 1 ? history[1].ts - history[0].ts : 0
    const interval = historyInterval > 0 ? historyInterval : Math.max(10_000, Math.ceil(hours * 3_600_000 / points))
    const anchor = history[0]?.ts ?? sampleTs - (points - 1) * interval
    const bucketTs = anchor + Math.floor((sampleTs - anchor) / interval) * interval
    const endTs = Math.max(history.at(-1)?.ts ?? bucketTs, bucketTs)
    const startTs = endTs - (points - 1) * interval
    if (bucketTs < startTs) continue

    const existing = new Map(history.map(point => [point.ts, point]))
    const bucket = existing.get(bucketTs)
    if (sampleTs < (bucket?.sampleTs ?? bucket?.ts ?? 0)) continue
    result[seriesName] = Array.from({ length: points }, (_, index) => {
      const ts = startTs + index * interval
      const point = { ...(existing.get(ts) || {}), ts }
      if (ts === bucketTs) {
        for (const key of keys) point[key] = data[`${seriesName}_${key}`]
        point.sampleTs = sampleTs
      }
      return point
    })
  }
  return result
}
