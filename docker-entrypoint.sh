#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$KEYPAGE_DATA_DIR"
  chown -R node:node "$KEYPAGE_DATA_DIR"
  exec su-exec node "$@"
fi

exec "$@"
