import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import { reactive } from 'vue'
import { mergeLiveLatencyWindow } from '../src/frontend/utils/latencyWindow.js'

test('server cards display live probe updates instead of cached history', async () => {
  const originalStorage = globalThis.localStorage
  globalThis.localStorage = { getItem: () => null }
  const vite = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false }
  })

  try {
    const { useServerCardData } = await vite.ssrLoadModule('/src/frontend/composables/useServerCardData.js')
    const props = reactive({
      server: {
        id: 'live-probe',
        ping_ct: 200,
        loss_ct: 100,
        ping: [{ ts: 1_792_800_000_000, ct: 40 }],
        loss: [{ ts: 1_792_800_000_000, ct: 0 }]
      },
      sysConfig: {}
    })
    const card = useServerCardData(props)
    const ct = () => card.threeNetDetails.value.find(row => row.key === 'ct')

    assert.equal(ct().latestPing, 200, 'a cached successful ping must not hide a newer live ping')
    assert.equal(ct().latestLoss, 100, 'live failures must not be averaged with old successful probes')
    props.server.ping_ct = 350
    props.server.loss_ct = 50
    assert.equal(ct().latestPing, 350)
    assert.equal(ct().latestLoss, 50)

    props.server.ping_ct = 'null'
    props.server.loss_ct = 100
    assert.equal(ct().latestPing, null, 'a live timeout must not fall back to an old success')
    assert.equal(ct().latestLoss, 100)
    props.server.ping_ct = 55
    props.server.loss_ct = 0
    assert.equal(ct().latestPing, 55)
    assert.equal(ct().latestLoss, 0, 'zero loss is a valid live measurement')

    delete props.server.ping_ct
    delete props.server.loss_ct
    props.server.loss.push({ ts: 1_792_800_360_000, ct: 50 })
    assert.equal(ct().latestPing, 40, 'historical values remain a fallback when live fields are absent')
    assert.equal(ct().latestLoss, 50, 'fallback uses the latest historical loss, not its average')

    props.server.loss = []
    assert.equal(card.formatLossValue(ct().latestLoss), '--', 'missing loss must not be shown as 0%')

    props.server.ping_ct = 200
    props.server.loss_ct = 1.67
    props.server.current_timestamp = baseTs + 2000
    props.server.probe_meta = { ct: { sampled_at: baseTs, samples: 60, lost: 1, window_seconds: 60, mode: 'icmp' } }
    assert.equal(ct().latestLoss, 1.67)
    assert.equal(ct().sampleInfo.summary, '1/60')
    props.server.current_timestamp = baseTs + 20_000
    assert.equal(ct().latestPing, null, 'repeated reports cannot disguise an expired probe')
    assert.equal(ct().latestLoss, null)
    props.server.probe_meta.ct.sampled_at = baseTs + 20_000
    assert.equal(ct().latestPing, 200)
    assert.equal(ct().latestLoss, 1.67)

  } finally {
    globalThis.localStorage = originalStorage
    await vite.close()
  }
})

const baseTs = 1_792_800_000_000
const interval = 360_001
const makeHistory = () => ({
  ping: Array.from({ length: 20 }, (_, index) => ({ ts: baseTs + index * interval, ct: 40, cu: 60 })),
  loss: Array.from({ length: 20 }, (_, index) => ({ ts: baseTs + index * interval, ct: 0, cu: 0 }))
})

test('live reports update the latest historical bucket without discarding the two-hour trend', () => {
  const history = makeHistory()
  const original = structuredClone(history)
  const timestamp = history.ping.at(-1).ts + 2000
  let server = { ...history, ...mergeLiveLatencyWindow(history, { ping_ct: 200, loss_ct: 100 }, timestamp) }
  assert.equal(server.ping.length, 20)
  assert.deepEqual(server.ping.slice(0, -1), history.ping.slice(0, -1))
  assert.equal(server.ping.at(-1).ct, 200)
  assert.equal(server.ping.at(-1).cu, 60, 'a partial report must retain other nodes')
  assert.equal(server.loss.at(-1).ct, 100)

  for (let offset = 4000; offset <= 60_000; offset += 2000) {
    server = { ...server, ...mergeLiveLatencyWindow(server, { ping_ct: 55, loss_ct: 0 }, timestamp + offset) }
  }
  assert.equal(server.ping.length, 20)
  assert.equal(server.ping[0].ts, baseTs, 'frequent reports must not compress two hours into forty seconds')
  assert.equal(server.loss.at(-1).ct, 0)
  assert.deepEqual(history, original, 'cached history objects must not be mutated')
})

test('live latency windows roll forward, retain gaps and reject stale replays', () => {
  const history = makeHistory()
  const timestamp = baseTs + 20 * interval + 2000
  const updated = mergeLiveLatencyWindow(history, { ping_ct: 'null', loss_ct: 100 }, timestamp)
  assert.equal(updated.ping.length, 20)
  assert.equal(updated.ping[0].ts, baseTs + interval)
  assert.equal(updated.ping.at(-1).ct, 'null')
  assert.equal(updated.loss.at(-1).ct, 100)
  assert.deepEqual(mergeLiveLatencyWindow(updated, { ping_ct: 20, loss_ct: 0 }, timestamp - 1000), {})

  const gap = mergeLiveLatencyWindow(updated, { ping_ct: 65, loss_ct: 0 }, timestamp + 3 * interval)
  assert.equal(gap.ping.at(-1).ct, 65)
  assert.equal(gap.ping.at(-2).ct, undefined, 'missing time buckets must not fabricate successful probes')
  assert.equal(gap.ping.at(-3).ct, undefined)
})

test('latency windows handle a cold start, disabled nodes and reports without probe samples', () => {
  assert.deepEqual(mergeLiveLatencyWindow(makeHistory(), { cpu: 50 }, baseTs), {})
  assert.deepEqual(mergeLiveLatencyWindow({}, { ping_ct: 10 }, 'invalid'), {})
  const fresh = mergeLiveLatencyWindow({}, { ping_ct: 25, loss_ct: 0, ping_cu: false, loss_cu: false }, baseTs / 1000)
  assert.equal(fresh.ping.length, 20)
  assert.equal(fresh.ping.at(-1).ts, baseTs)
  assert.equal(fresh.ping.at(-1).ct, 25)
  assert.equal(fresh.loss.at(-1).ct, 0)
  assert.equal(fresh.loss.at(-1).cu, false)
  assert.equal(fresh.ping.at(-2).ct, undefined)
})
