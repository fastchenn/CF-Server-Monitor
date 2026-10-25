//go:build linux && !(amd64 || arm64 || 386 || arm || loong64)

package cfprobe

// gopsutil CPU sampling is only wired up for the architectures we build and
// test. Other Linux architectures (mips, mipsle, mips64, mips64le, riscv64,
// s390x, ppc64le, ...) fall back to the /proc/stat sampling implemented in
// readCPUPercent, which is dependency free and works on every Linux port.
func readGopsutilCPUPercent() (float64, bool) {
	return 0, false
}
