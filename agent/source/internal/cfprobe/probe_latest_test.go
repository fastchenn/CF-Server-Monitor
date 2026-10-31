package cfprobe

import (
	"testing"
	"time"
)

func TestLatestProbeRTTRespondsImmediatelyWhileLossUsesWindow(t *testing.T) {
	now := time.Now()
	history := rollingProbeHistory{}
	for i := 0; i < 59; i++ {
		history.add(now.Add(time.Duration(i)*time.Second), "target", ProbeResult{RTTMs: 10, OK: true})
	}
	history.add(now.Add(59*time.Second), "target", ProbeResult{RTTMs: 215, OK: true})
	got := history.latestSnapshot(now.Add(59 * time.Second))
	if got.RTTMs != 215 || !got.OK || got.Loss != 0 {
		t.Fatalf("latest RTT was smoothed: %+v", got)
	}
	history.add(now.Add(60*time.Second), "target", ProbeResult{RTTMs: -1, Loss: 100, OK: false})
	got = history.latestSnapshot(now.Add(60 * time.Second))
	if got.RTTMs != -1 || got.OK || got.Loss != 1 {
		t.Fatalf("latest timeout or rolling loss incorrect: %+v", got)
	}
	history.add(now.Add(61*time.Second), "target", ProbeResult{RTTMs: 37, OK: true})
	got = history.latestSnapshot(now.Add(61 * time.Second))
	if got.RTTMs != 37 || !got.OK || got.Loss != 1 {
		t.Fatalf("recovery was delayed or prior loss was erased: %+v", got)
	}
}
