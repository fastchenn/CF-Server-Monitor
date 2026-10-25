# Live Agent

This directory contains an MIT-licensed fork of `huilang-me/cfsm-agent` v1.1.0, upstream commit `3d1c73768442159d0c0e136121d15a84d35e1025`.

Changes:

- Each target has an independent one-second probe loop. A timeout or public-IP lookup cannot delay other targets.
- Latency reports the latest completed probe, including a timeout, rather than a two-minute median.
- Loss is failed attempts divided by actual attempts within the most recent 60 seconds. Fractional percentages are preserved.
- Reports include the measurement timestamp, failed/total counts, mode, and window. No samples or permission/DNS errors produce unknown values, rather than a fabricated 0%.
- Buffered metric samples include their own probe values and metadata.

The bootstrap installer is served at `/agent/install.sh`. Empty Agent version + Linux in the admin copy-command dialog selects this build. Explicit upstream versions and other operating systems continue to use the upstream installer. Current live binaries support Linux amd64 and arm64.

Build before building the frontend:

```sh
npm run build:agent
npm run build:frontend
```

Go must meet `source/go.mod`. `CFSM_GO` can select a Go executable. Generated binaries are excluded from Git and packaged as Worker static assets. `SHA256SUMS` is checked before installation. The deployment workflow builds them from the tracked source.

The live installer sets `auto_update=0` to prevent upstream auto-update from replacing this fork with the old probing implementation. Re-run the site's copy command to install a new live version. Installation preserves the existing service/config paths and traffic totals using the upstream install implementation.

ICMP requires the relevant raw-socket permission (root with this installer). ICMP rate limiting, a closed TCP port, and DNS or permission failures must be distinguished from real path packet loss. A measured `0/60` is a valid result; this build does not invent failures.

See `source/LICENSE` for the original license.
