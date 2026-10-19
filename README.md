# FlowPT

Charting and invoicing for solo private healthcare practitioners (BC, Canada first).

## Layout
- `apps/desktop` – Electron + Vite + React + TS + Tailwind (phase 1, scaffolded)
- `apps/web` – PWA (phase 2, placeholder)
- `apps/mobile` – Capacitor (phase 3, placeholder)
- `packages/shared` – shared types/logic

## Run
```
npm install
npm run dev:desktop
```
Local DB: `better-sqlite3-multiple-ciphers` (SQLCipher), native module rebuilt for Electron on install.
