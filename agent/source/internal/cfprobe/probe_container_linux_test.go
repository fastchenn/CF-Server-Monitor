//go:build linux

package cfprobe

import (
	"errors"
	"os"
	"syscall"
	"testing"
	"time"
)

// Run only on the target NAT container: it allows Linux ping sockets for gid 0,
// but deliberately omits CAP_NET_RAW from its capability bounding set.
func TestRestrictedContainerICMP(t *testing.T) {
	if os.Getenv("CF_PROBE_CONTAINER_TEST") != "1" {
		t.Skip("requires the restricted target container")
	}
	_, err := icmpPingWithPrivilege("1.1.1.1", 1500*time.Millisecond, true)
	if !errors.Is(err, syscall.EPERM) && !errors.Is(err, syscall.EACCES) {
		t.Fatalf("raw ICMP should be denied in target container, got %v", err)
	}
	for _, target := range []string{"1.1.1.1", "182.40.97.247:443", "61.179.132.179:80", "120.221.173.237:80"} {
		ms, err := icmpPing(target, 1500*time.Millisecond)
		if err != nil || ms < 1 {
			t.Fatalf("unprivileged ICMP %s: rtt=%d err=%v", target, ms, err)
		}
		t.Logf("%s RTT=%dms", target, ms)
	}
}
