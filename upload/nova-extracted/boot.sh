#!/bin/bash
# APK Boot Script — runs on first launch of the APK
# Ensures:
#   1. Database exists and schema is pushed
#   2. AI config is available (from env vars or bundled file)
#   3. Next.js server starts
#
# Usage: ./boot.sh (or automatically called by the APK's main activity)

set -e

cd "$(dirname "$0")"
echo "=== ATLAS // NOVA // FORGE — APK Boot ==="

# 1. Ensure db directory exists
mkdir -p db

# 2. Push schema if DB doesn't exist or is empty
if [ ! -f db/custom.db ] || [ ! -s db/custom.db ]; then
  echo "[BOOT] First run — creating database..."
  bun run db:push 2>&1 | tail -3
else
  echo "[BOOT] Database exists ($(du -h db/custom.db | cut -f1))"
fi

# 3. Check AI config
if [ -f .z-ai-config ]; then
  echo "[BOOT] AI config found (.z-ai-config)"
elif [ -n "$ZAI_BASE_URL" ] && [ -n "$ZAI_API_KEY" ]; then
  echo "[BOOT] AI config from env vars (ZAI_*)"
elif [ -n "$OPENAI_BASE_URL" ] && [ -n "$OPENAI_API_KEY" ]; then
  echo "[BOOT] OpenAI-compat config from env vars"
else
  echo "[BOOT] ⚠ No AI config — local fallback will be used"
  echo "       Configure via: POST /api/ai/setup or set ZAI_* env vars"
fi

# 4. Start Next.js server
echo "[BOOT] Starting Next.js server on port 3000..."
exec bun run dev
