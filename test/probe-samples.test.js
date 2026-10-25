import assert from 'node:assert/strict'
import test from 'node:test'
import { Miniflare } from 'miniflare'
import { saveMetricsHistory } from '../src/database/schema.js'
import { HISTORY_TABLE_COLUMNS } from '../src/utils/historyFields.js'
import { normalizeProbeMetadata, coerceNumericMetricFields } from '../src/utils/metrics.js'
import { toBroadcastSamples } from '../src/handlers/update.js'
import { getProbeSampleInfo, getCurrentProbeMetric } from '../src/frontend/utils/latencyWindow.js'

const timestamp = 1_792_800_000_000
const meta = { ct: { sampled_at: timestamp, samples: 60, lost: 1, window_seconds: 60, mode: 'icmp' } }

test('actual attempt counts and fractional loss survive full and buffered broadcasts', () => {
  const metrics = { ping_ct: '200', loss_ct: '1.67', probe_meta: meta }
  const samples = [{ ts: timestamp, metrics }, { ts: timestamp + 1000, metrics }]
  const result = toBroadcastSamples('server-1', samples, '', 'v1.1.0-live.1', metrics)
  for (const sample of result) {
    assert.equal(sample.payload.ping_ct, 200)
    assert.equal(sample.payload.loss_ct, 1.67)
    assert.deepEqual(sample.payload.probe_meta.ct, meta.ct)
    const info = getProbeSampleInfo(sample.payload, 'ct', timestamp + 2000)
    assert.equal(info.summary, '1/60')
    assert.equal(info.unavailable, false)
  }
})

test('new report timestamps do not disguise old probe samples as fresh', () => {
  const server = { last_updated: timestamp + 30_000, ping_ct: 40, loss_ct: 0, probe_meta: meta }
  const info = getProbeSampleInfo(server, 'ct', timestamp + 30_000)
  assert.equal(info.age, 30)
  assert.equal(info.unavailable, true)
  const noSamples = { probe_meta: { ct: { ...meta.ct, sampled_at: 0, samples: 0, lost: 0 } } }
  assert.equal(getProbeSampleInfo(noSamples, 'ct', timestamp).unavailable, true)
  assert.equal(getProbeSampleInfo(noSamples, 'ct', timestamp).summary, '--')
  assert.equal(getCurrentProbeMetric({ loss_ct: 'null' }, 'loss_ct'), null)
})

test('permission errors remain unknown while measured zero loss stays valid', () => {
  const unavailable = { probe_meta: { ct: { ...meta.ct, problem: 'ICMP permission denied' } } }
  assert.equal(getProbeSampleInfo(unavailable, 'ct', timestamp).unavailable, true)
  const healthy = { loss_ct: 0, probe_meta: { ct: { ...meta.ct, lost: 0 } } }
  assert.equal(getProbeSampleInfo(healthy, 'ct', timestamp).unavailable, false)
  assert.equal(getProbeSampleInfo(healthy, 'ct', timestamp).summary, '0/60')
  assert.equal(getCurrentProbeMetric(healthy, 'loss_ct'), 0)
})

test('metadata validation rejects impossible counts, including reports with empty disk metrics', () => {
  const malformed = { ct: { ...meta.ct, lost: 61 }, unexpected: meta.ct }
  assert.deepEqual(normalizeProbeMetadata(malformed), {})
  assert.deepEqual(coerceNumericMetricFields({ disk: {}, probe_meta: malformed }).probe_meta, {})
  assert.deepEqual(normalizeProbeMetadata(meta), meta)
})

test('D1 history retains sub-percent loss instead of truncating it to zero', async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("OK") } }',
    d1Databases: { DB: 'fractional-probe-loss-test' }
  })
  try {
    const db = await miniflare.getD1Database('DB')
    await db.prepare(`CREATE TABLE metrics_history (${HISTORY_TABLE_COLUMNS.map(([name, type]) => `${name} ${type}`).join(', ')})`).run()
    await saveMetricsHistory(db, 'fractional-loss', 1, {
      loss_ct: '0.42', loss_cu: '1.67', loss_cm: 'null', loss_bd: false
    }, '', timestamp, 'v1.1.0-live.1')
    const row = await db.prepare('SELECT loss_ct, loss_cu, loss_cm, loss_bd FROM metrics_history').first()
    assert.equal(row.loss_ct, 0.42)
    assert.equal(row.loss_cu, 1.67)
    assert.equal(row.loss_cm, null)
    assert.equal(row.loss_bd, 'false')
  } finally {
    await miniflare.dispose()
  }
})
