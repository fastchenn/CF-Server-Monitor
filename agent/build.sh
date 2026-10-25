#!/bin/sh
set -eu
root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
version="$(cat "$root/agent/VERSION")"
out="$root/public/agent/bin/$version"
go_bin="${CFSM_GO:-go}"
grep -Fq "LIVE_VERSION=\"$version\"" "$root/public/agent/install.sh" || { printf "Installer version mismatch\n" >&2; exit 1; }
mkdir -p "$out"
cd "$root/agent/source"
for arch in amd64 arm64; do
  CGO_ENABLED=0 GOOS=linux GOARCH="$arch" "$go_bin" build -buildvcs=false -trimpath -ldflags="-s -w -X main.version=$version" -o "$out/cf-probe-linux-$arch" ./cmd/cf-probe
done
for arch in amd64 arm64; do
  gzip -n -9 -c "$out/cf-probe-linux-$arch" > "$out/cf-probe-linux-$arch.gz"
  rm "$out/cf-probe-linux-$arch"
done
cd "$out"
sha256sum cf-probe-linux-amd64.gz cf-probe-linux-arm64.gz > SHA256SUMS
printf 'Built %s: Linux amd64 and arm64\n' "$version"
