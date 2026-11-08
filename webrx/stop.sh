#!/bin/sh
# Web SDR (OpenWebRX+) stop: prints one JSON object. See webrx.py and README.md.
exec /usr/bin/env python3 "$(cd "$(dirname "$0")" && pwd)/webrx.py" stop "$@"
