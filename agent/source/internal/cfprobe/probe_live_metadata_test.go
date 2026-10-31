package cfprobe

import (
	"context"
	"net"
	"testing"
	"time"
)

func TestProbeLossPreservesFractionalPacketRate(t *testing.T) {
	got := probeLossValue("example.com", ProbeResult{Loss: 1}, map[string]any{"samples": 60, "lost": 1})
	if got != "1.7" {
		t.Fatalf("one lost packet out of 60: got %v, want 1.7", got)
	}
}

func TestLiveProbePublishesMeasuredCountsAndFailure(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for {
			c, err := listener.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	agent := &Agent{cfg: Config{PingMode: pingModeTCP, CTNode: listener.Addr().String()}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go agent.runProbeWorker(ctx, "ct")
	waitFor := func(wantFailure bool) map[string]any {
		t.Helper()
		deadline := time.Now().Add(4 * time.Second)
		for time.Now().Before(deadline) {
			agent.mu.RLock()
			meta, _ := agent.probes.Meta["ct"].(map[string]any)
			result := agent.probes.CT
			agent.mu.RUnlock()
			if meta != nil && meta["samples"].(int) >= 2 && (meta["lost"].(int) > 0) == wantFailure {
				if !wantFailure && (!result.OK || result.RTTMs < 1) {
					t.Fatal("successful latest sample has no valid RTT")
				}
				if wantFailure && (result.OK || result.RTTMs != -1) {
					t.Fatal("latest timeout was hidden by older successful samples")
				}
				if time.Since(time.UnixMilli(meta["sampled_at"].(int64))) > 2*time.Second {
					t.Fatal("metadata is stale")
				}
				return meta
			}
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatal("probe counts were not updated")
		return nil
	}
	meta := waitFor(false)
	if meta["window_seconds"] != 60 {
		t.Fatal("wrong rolling window")
	}
	listener.Close()
	meta = waitFor(true)
	metrics := Metrics{ProbeMeta: map[string]any{"ct": meta}, PingCT: "1", LossCT: "33"}
	for _, payload := range []map[string]any{metricsToMap(metrics), sampleMetricsToMap(metrics)} {
		if payload["probe_meta"] == nil || payload["ping_ct"] != "1" || payload["loss_ct"] != "33" {
			t.Fatal("full or live sample report omitted probe fields")
		}
	}
}
