#!/bin/sh
set -eu

# Railway volumes mount as root. The MCP file tools may only write under /data.
chown app:app /data
exec su-exec app "$@"
