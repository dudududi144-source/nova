#!/bin/bash
while true; do
  cd /home/z/my-project/.next/standalone
  NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NODE_OPTIONS="--max-old-space-size=512" node server.js 2>>/home/z/my-project/prod.log
  echo "[$(date)] Server restarted" >> /home/z/my-project/keepalive.log
  sleep 1
done
