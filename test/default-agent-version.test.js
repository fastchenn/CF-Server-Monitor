import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LIVE_AGENT_VERSION, getDefaultAgentVersion, usesLiveAgent } from '../src/frontend/utils/agentInstall.js'

test('the default Linux version resolves to the downloadable site release', () => {
  const version = readFileSync(new URL('../agent/VERSION', import.meta.url), 'utf8').trim()
  const installer = readFileSync(new URL('../public/agent/install.sh', import.meta.url), 'utf8')
  assert.equal(getDefaultAgentVersion('linux'), version)
  assert.equal(LIVE_AGENT_VERSION, version)
  assert.ok(installer.includes(`LIVE_VERSION="${version}"`))
  assert.equal(usesLiveAgent('linux', version), true)
  assert.equal(usesLiveAgent('linux', ''), true)
})

test('explicit upstream versions and other platforms use the upstream installer', () => {
  assert.equal(usesLiveAgent('linux', 'v1.1.1'), false)
  assert.equal(usesLiveAgent('linux', 'latest'), false)
  for (const platform of ['windows', 'docker', 'mac', 'unix']) {
    assert.equal(getDefaultAgentVersion(platform), '')
    assert.equal(usesLiveAgent(platform, LIVE_AGENT_VERSION), false)
  }
})
