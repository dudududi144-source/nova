# NOVA Backups

This folder contains install-ready ZIP backups of the NOVA project, created each cycle.

## Latest backup

**`nova-v21-backup.zip`** — 225KB, install-ready

### To restore from a backup:

```bash
# 1. Extract the zip to a new directory
unzip nova-v21-backup.zip -d nova-restored

# 2. Enter the directory
cd nova-restored

# 3. Install dependencies
bun install

# 4. Copy env file
cp .env.example .env

# 5. Start the dev server
bun run dev
```

Use the Preview Panel to view the app (do not navigate to localhost directly).

### What's in the backup

- All source code (`src/`)
- All tests (`tests/`)
- Config files (package.json, tsconfig.json, next.config.ts, postcss.config.mjs, etc.)
- `.env.example` (copy to `.env`)
- `README.md` with full install instructions
- `worklog.md` with development history

### What's NOT in the backup

- `node_modules/` (run `bun install` to recreate)
- `.next/` build cache (regenerated on dev start)
- `db/*.db` (SQLite database, not used by NOVA v1 but referenced by scaffold)
- `dev.log` / `server.log` (runtime logs)
