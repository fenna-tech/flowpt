import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The workspace packages ship TS source; Vite compiles them like app code.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 }
})
