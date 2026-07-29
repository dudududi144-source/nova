#!/bin/bash
cd /home/z/my-project
export CHOKIDAR_USEPOLLING=true
export NEXT_TELEMETRY_DISABLED=1
# Double-fork to fully detach from the parent shell so the dev server
# survives after the launching command exits.
(nohup node node_modules/next/dist/bin/next dev -p 3000 > dev.log 2>&1 &)
