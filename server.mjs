/*
 * Production server: serves the built app from dist/ and proxies /openai/* to the API.
 *
 *   npm run build && npm start
 *
 * This is what Render (or any host) runs. It replaces `vite` in production, which is a
 * dev server and must never be exposed. Unlike the old serve.js, the proxy target is
 * fixed to api.openai.com — it takes no ?url=, so it cannot be used as an open relay.
 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

// Render (and most hosts) inject PORT and expect the app on 0.0.0.0, not localhost.
const PORT = Number(process.env.PORT) || 10000
const HOST = process.env.HOST || '0.0.0.0'

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const UPSTREAM = 'https://api.openai.com'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/* headers that describe *this* hop and must not be forwarded */
const HOP = new Set(['host', 'connection', 'content-length', 'accept-encoding'])

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function proxy(req, res) {
  const target = UPSTREAM + req.url.slice('/openai'.length)
  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k.toLowerCase())) headers[k] = v

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)

  try {
    const upstream = await fetch(target, { method: req.method, headers, body })
    const out = {}
    upstream.headers.forEach((v, k) => {
      const lk = k.toLowerCase()
      if (lk === 'content-encoding' || lk === 'content-length' || lk === 'transfer-encoding') return
      out[k] = v
    })
    res.writeHead(upstream.status, out)
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res) // streams SSE too
    else res.end()
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ proxy_error: String(err?.message ?? err), target }, null, 2))
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const rel = decodeURIComponent(url.pathname)
  const file = path.join(DIST, rel === '/' ? 'index.html' : rel)

  // never serve outside dist/
  if (!file.startsWith(DIST)) {
    res.writeHead(403)
    return res.end('Forbidden')
  }

  try {
    const data = await readFile(file)
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    // hashed asset names make everything under /assets safe to cache forever
    const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache })
    res.end(data)
  } catch {
    // unknown path: hand back index.html so the SPA can route it
    try {
      const html = await readFile(path.join(DIST, 'index.html'))
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' })
      res.end(html)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('dist/ is missing — run "npm run build" first.')
    }
  }
}

http
  .createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      return res.end('ok')
    }
    if (req.url.startsWith('/openai/')) return void proxy(req, res)
    return void serveStatic(req, res)
  })
  .listen(PORT, HOST, () => {
    console.log(`  serving dist/ on http://${HOST}:${PORT}  (proxying /openai -> ${UPSTREAM})`)
  })
