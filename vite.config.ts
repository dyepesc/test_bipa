import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The port lives in package.json -> "config": { "port": ... }, which npm exposes to
// every script as npm_package_config_port, so vite and scripts/stop.mjs agree on it.
// PORT wins for a one-off:  $env:PORT=9000; npm run dev
const PORT = Number(process.env.PORT || process.env.npm_package_config_port) || 5180

// Requests to /openai/* are forwarded to api.openai.com by the dev server,
// so the browser never makes a cross-origin call and CORS never applies.
// This replaces the standalone serve.js proxy.
const proxy = {
  '/openai': {
    target: 'https://api.openai.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/openai/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { port: PORT, strictPort: true, proxy },
  preview: { port: PORT, strictPort: true, proxy },
})
