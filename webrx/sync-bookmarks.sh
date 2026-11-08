#!/bin/sh
# Web SDR bookmarks from the Radio tab: prints one JSON object. See webrx.py and README.md.
exec /usr/bin/env python3 "$(cd "$(dirname "$0")" && pwd)/webrx.py" sync-bookmarks "$@"
