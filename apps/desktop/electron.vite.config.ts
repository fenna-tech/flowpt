import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The shared package ships TS source, so bundle it instead of treating it as an external dep
// (Node cannot load its extensionless relative imports at runtime).
const shared = { '@flowpt/shared': resolve('../../packages/shared/src/index.ts') }
const bundleShared = { build: { externalizeDeps: { exclude: ['@flowpt/shared'] } } }

export default defineConfig({
  main: { ...bundleShared, resolve: { alias: shared } },
  preload: { ...bundleShared, resolve: { alias: shared } },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        ...shared
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
