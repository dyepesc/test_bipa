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

## The API key

The key lives in React state and is sent only to the API. "Remember the key in this
browser" writes it to `localStorage` in plain text — convenient on your own machine,
not something to switch on elsewhere. Unchecking it clears the stored copy.

## Layout

- [src/App.tsx](src/App.tsx) — the whole UI and the request lifecycle.
- [src/openai.ts](src/openai.ts) — body building, response parsing, `GET /v1/models`.
- [vite.config.ts](vite.config.ts) — port and proxy.
- [scripts/stop.mjs](scripts/stop.mjs) — `npm run stop`, and the pre-step of `npm run dev`.
- `image-report-api-tester.html` / `serve.js` — the original tester, kept for reference.
