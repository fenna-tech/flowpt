/// <reference types="vite/client" />
import type { FlowptApi } from '@flowpt/shared'

// The host (Electron preload or the web bootstrap) installs this before the UI mounts.
declare global {
  interface Window {
    api: FlowptApi
  }
}
