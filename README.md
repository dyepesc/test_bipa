# ChatGPT API tester (React + Vite)

A one-page tester for the OpenAI chat API: paste a key, pick a model, drop one or
more images, write a prompt, send, and read the answer plus the raw JSON.

React port of `image-report-api-tester.html`. The CORS proxy that used to live in
`serve.js` is now part of the Vite dev server, so the port is configured in one
place: `vite.config.ts`.

## Run it

```bash
npm install
npm run dev     # start  -> http://localhost:5180   (Ctrl+C also stops it)
npm run stop    # stop   -> kills whatever holds the port
```

`npm run dev` frees the port before starting, so a server left running from an earlier
session (or one started in another window) is replaced instead of causing an
"address already in use" error. `strictPort` is on, so the server never silently
moves to another port.

The port is `"config": { "port": "5180" }` in `package.json` — npm passes it to both
`vite.config.ts` and `scripts/stop.mjs`, so changing it there changes it everywhere.
For one run only:

```bash
PORT=9000 npm run dev              # bash / git bash
$env:PORT=9000; npm run dev        # PowerShell — use the same PORT for npm run stop
```

## The two request paths

The **Request path** dropdown decides how the browser reaches OpenAI:

- **Vite proxy `/openai`** (default) — the browser calls `/openai/v1/...` on the dev
  server, which forwards it to `https://api.openai.com`. Same origin, so CORS never
  applies. Works in `npm run dev` and `npm run preview`.
- **Direct** — the browser calls `https://api.openai.com` itself. Useful for
  checking that the API is reachable without the proxy.

The proxy only exists while a Vite server is running. A static `npm run build`
deployed elsewhere has to use the direct path, or a proxy of its own.

## What gets sent

`POST /v1/chat/completions` with a single user message: the prompt as a `text`
part, then one `image_url` part per image, each carrying a `data:` URL of the file.
The **Request sent** tab shows the exact body with the image data truncated.

- **Max output tokens** is sent as `max_completion_tokens`; leave it empty to omit it.
- **Temperature** is omitted when empty. Leave it empty for gpt-5 and the o-series,
  which only accept the default value.
- **Image detail** (`low` / `high`) is omitted on `auto`.

## Deploying (Render)

Never run `npm run dev` on a host. Vite's dev server binds to localhost, so Render's
port scan finds nothing and the deploy times out; it also refuses requests from an
unknown hostname. Build the app and serve it instead:

| Setting        | Value                                   |
| -------------- | --------------------------------------- |
| Build Command  | `npm ci --include=dev && npm run build` |
| Start Command  | `npm start`                             |
| Health Check   | `/healthz`                              |

`--include=dev` is required because Render sets `NODE_ENV=production`, and npm then
skips `devDependencies` — where vite and typescript live. Without it the build dies
with `vite: not found`. [render.yaml](render.yaml) sets all of this already.

`npm start` runs [server.mjs](server.mjs): it serves `dist/` and keeps the `/openai`
proxy, so the deployed app behaves exactly like the dev one. It binds `0.0.0.0` and
honours the `PORT` that the host injects. The proxy target is hard-coded to
api.openai.com, so it cannot be abused as an open relay the way `serve.js` could.

Anyone who opens the deployed page types **their own** key; nothing is stored on the
server. Do not bake a shared key into the deployment — the page runs in the visitor's
browser, so any key it holds is visible to them.

## The API key

The key lives in React state and is sent only to the API. "Remember the key in this
browser" writes it to `localStorage` in plain text — convenient on your own machine,
not something to switch on elsewhere. Unchecking it clears the stored copy.

## Layout

- [src/App.tsx](src/App.tsx) — the whole UI and the request lifecycle.
- [src/openai.ts](src/openai.ts) — body building, response parsing, `GET /v1/models`.
- [vite.config.ts](vite.config.ts) — port and proxy.
- [scripts/stop.mjs](scripts/stop.mjs) — `npm run stop`, and the pre-step of `npm run dev`.
- [server.mjs](server.mjs) — production server: static `dist/` + the same `/openai` proxy.
- [render.yaml](render.yaml) — deploy settings.
- `image-report-api-tester.html` / `serve.js` — the original tester, kept for reference.
