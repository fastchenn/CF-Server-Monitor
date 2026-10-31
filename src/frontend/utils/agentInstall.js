export const LIVE_AGENT_VERSION = 'v1.1.0-live.4-instant'

export const getDefaultAgentVersion = (targetOs) => targetOs === 'linux' ? LIVE_AGENT_VERSION : ''

export const usesLiveAgent = (targetOs, version) => {
  const value = String(version || '').trim()
  return targetOs === 'linux' && (!value || value === LIVE_AGENT_VERSION)
}
