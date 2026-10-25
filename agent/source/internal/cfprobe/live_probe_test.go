package cfprobe

import (
	"context"
	"math"
	"testing"
	"time"
)

func TestLiveProbeShowsLatencySpikeWithoutMedianSmoothing(t *testing.T) {
	now := time.Unix(1000, 0)
	h := rollingProbeHistory{}
	for i, rtt := range []int{40, 41, 42, 300} {
		h.add(now.Add(time.Duration(i)*time.Second), "icmp\x00target", ProbeResult{RTTMs: rtt, OK: true})
	}
	got := h.snapshot(now.Add(3 * time.Second))
	if got.RTTMs != 300 || got.Samples != 4 {
		t.Fatalf("spike hidden: %+v", got)
	}
}

func TestLiveProbeCountsFractionalLossAndExpiresOldAttempts(t *testing.T) {
	now := time.Unix(1000, 0)
	h := rollingProbeHistory{}
	for i := 0; i < 60; i++ {
		r := ProbeResult{RTTMs: 42, OK: true}
		if i == 0 {
			r = ProbeResult{RTTMs: -1, Loss: 100, OK: false}
		}
		h.add(now.Add(time.Duration(i)*time.Second), "target", r)
	}
	got := h.snapshot(now.Add(59 * time.Second))
	if got.Samples != 60 || got.Lost != 1 || math.Abs(got.Loss-100.0/60) > 0.00001 {
		t.Fatalf("wrong sample counts: %+v", got)
	}
	if probeLossValue("target", got) != "1.67" {
		t.Fatalf("fractional loss was rounded away: %v", probeLossValue("target", got))
	}
	expired := h.snapshot(now.Add(3 * time.Minute))
	if expired.Samples != 0 || expired.Loss != -1 || !expired.Unavailable {
		t.Fatalf("expired samples treated as fresh: %+v", expired)
	}
}

func TestLiveProbeTimeoutIsImmediateAndRecoveryKeepsFailureCount(t *testing.T) {
	now := time.Unix(1000, 0)
	h := rollingProbeHistory{}
	h.add(now, "target", ProbeResult{RTTMs: 40, OK: true})
	h.add(now.Add(time.Second), "target", ProbeResult{RTTMs: -1, Loss: 100, OK: false})
	failed := h.snapshot(now.Add(time.Second))
	if failed.OK || failed.RTTMs != -1 || failed.Loss != 50 {
		t.Fatalf("timeout hidden by old success: %+v", failed)
	}
	h.add(now.Add(2*time.Second), "target", ProbeResult{RTTMs: 55, OK: true})
	recovered := h.snapshot(now.Add(2 * time.Second))
	if !recovered.OK || recovered.RTTMs != 55 || recovered.Lost != 1 || recovered.Samples != 3 {
		t.Fatalf("bad recovery: %+v", recovered)
	}
}

func TestLiveProbeUnknownAndPermissionErrorsAreNotZeroLoss(t *testing.T) {
	if probeLossValue("target", ProbeResult{}) != "null" {
		t.Fatal("no sample must not be 0%")
	}
	now := time.Unix(1000, 0)
	h := rollingProbeHistory{}
	h.add(now, "target", ProbeResult{RTTMs: 40, OK: true})
	h.add(now.Add(time.Second), "target", ProbeResult{RTTMs: -1, Loss: -1, Unavailable: true, Problem: "ICMP permission denied"})
	got := h.snapshot(now.Add(time.Second))
	if got.Samples != 1 || !got.Unavailable || probeLossValue("target", got) != "null" {
		t.Fatalf("permission error counted as packet loss: %+v", got)
	}
	h.add(now.Add(2*time.Second), "other-target", ProbeResult{RTTMs: 70, OK: true})
	reset := h.snapshot(now.Add(2 * time.Second))
	if reset.Samples != 1 || reset.Lost != 0 || reset.RTTMs != 70 {
		t.Fatalf("target change retained old attempts: %+v", reset)
	}
}

func TestLiveProbeWorkersDoNotWaitForAnotherTarget(t *testing.T) {
	a := &Agent{cfg: Config{CTNode: "slow", CUNode: "fast", PingMode: pingModeICMP}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	slowStarted := make(chan struct{})
	releaseSlow := make(chan struct{})
	fastCalled := make(chan struct{}, 1)
	measure := func(kind, target string) ProbeResult {
		if target == "slow" {
			close(slowStarted)
			<-releaseSlow
		} else {
			select {
			case fastCalled <- struct{}{}:
			default:
			}
		}
		return ProbeResult{RTTMs: 42, OK: true}
	}
	done := make(chan struct{}, 2)
	go func() { a.runProbeWorker(ctx, 0, measure); done <- struct{}{} }()
	<-slowStarted
	go func() { a.runProbeWorker(ctx, 1, measure); done <- struct{}{} }()
	select {
	case <-fastCalled:
	case <-time.After(750 * time.Millisecond):
		cancel()
		close(releaseSlow)
		t.Fatal("a slow target blocked another target")
	}
	cancel()
	close(releaseSlow)
	<-done
	<-done
}

func TestBufferedSamplesCarryTheirOwnProbeValuesAndCounts(t *testing.T) {
	meta := map[string]ProbeMetadata{"ct": {SampledAt: 1234, Samples: 60, Lost: 1, WindowSeconds: 60, Mode: pingModeICMP}}
	sample := sampleMetricsToMap(Metrics{CPU: "5", PingCT: "200", LossCT: "1.67", ProbeMeta: meta})
	if sample["ping_ct"] != "200" || sample["loss_ct"] != "1.67" || sample["probe_meta"] == nil {
		t.Fatalf("probe data missing from sample: %+v", sample)
	}
}
