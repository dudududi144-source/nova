#!/bin/bash
cd /home/z/my-project
pkill -f "next dev" 2>/dev/null
sleep 1
nohup bun run dev </dev/null >dev.log 2>&1 &
echo $! > /home/z/my-project/.dev-pid
