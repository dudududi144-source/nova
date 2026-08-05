#!/bin/bash
# Auto-restart wrapper for Next.js dev server.
# Restarts the server if it crashes.

cd /home/z/my-project

while true; do
  echo "[$(date)] Starting Next.js dev server..."
  NODE_OPTIONS="--max-old-space-size=1536" /home/z/my-project/node_modules/.bin/next dev -p 3000 --webpack 2>&1 | tee /tmp/nova-dev.log
  EXIT_CODE=$?
  echo "[$(date)] Server crashed (exit $EXIT_CODE). Restarting in 3s..."
  sleep 3
done
