import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import './App.css'
import {
  DEFAULT_MODELS,
  EFFORTS,
  baseUrl,
  buildBody,
  extractText,
  fileToDataUrl,
  fmtBytes,
  listModels,
  previewBody,
  usageLine,
} from './openai'
import type { Detail, ImageItem, Transport } from './openai'

const STORE_KEY = 'test_gpt.settings'
const STORE_APIKEY = 'test_gpt.apikey'
/* sentinel value of the model dropdown's last entry */
const CUSTOM = '__custom__'

type Tab = 'text' | 'raw' | 'request'

type Saved = {
  model: string
  transport: Transport
  detail: Detail
  maxTokens: string
  temperature: string
  effort: string
  prompt: string
  rememberKey: boolean
}

function loadSaved(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Partial<Saved>
  } catch {
    return {}
  }
}

/* read once, when the module loads, so every field can seed itself from it */
const saved = loadSaved()

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORE_APIKEY) ?? '')
  const [rememberKey, setRememberKey] = useState(saved.rememberKey ?? false)
  const [transport, setTransport] = useState<Transport>(saved.transport ?? 'proxy')

  const [models, setModels] = useState<string[]>(DEFAULT_MODELS)
  const [model, setModel] = useState(saved.model ?? DEFAULT_MODELS[0])
  const [modelsNote, setModelsNote] = useState('')
  /* a model id the dropdown does not list (typed by hand, or from an older session) */
  const [customModel, setCustomModel] = useState(
    () => !DEFAULT_MODELS.includes(saved.model ?? DEFAULT_MODELS[0]),
  )

  const [images, setImages] = useState<ImageItem[]>([])
  const [detail, setDetail] = useState<Detail>(saved.detail ?? 'auto')
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const [prompt, setPrompt] = useState(
    saved.prompt ?? 'Describe this image in detail and list anything unusual you see.',
  )
  const [maxTokens, setMaxTokens] = useState(saved.maxTokens ?? '4000')
  const [temperature, setTemperature] = useState(saved.temperature ?? '')
  const [effort, setEffort] = useState(saved.effort ?? '')

  const [sending, setSending] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const [tab, setTab] = useState<Tab>('text')
  const [text, setText] = useState('Ready.')
  const [raw, setRaw] = useState('')
  const [request, setRequest] = useState('')
  const [status, setStatus] = useState('idle')
  const [elapsed, setElapsed] = useState('—')
  const [usage, setUsage] = useState('—')
  const [ok, setOk] = useState<boolean | null>(null)

  /* persist the settings, and the key only when asked to */
  useEffect(() => {
    const toSave: Saved = { model, transport, detail, maxTokens, temperature, effort, prompt, rememberKey }
    localStorage.setItem(STORE_KEY, JSON.stringify(toSave))
    if (rememberKey) localStorage.setItem(STORE_APIKEY, apiKey)
    else localStorage.removeItem(STORE_APIKEY)
  }, [model, transport, detail, maxTokens, temperature, effort, prompt, rememberKey, apiKey])

  /* ---------- images ---------- */

  async function addFiles(list: FileList | File[]) {
    const added: ImageItem[] = []
    for (const file of Array.from(list)) {
      if (!file.type.startsWith('image/')) continue
      added.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name || `pasted-${Date.now()}.png`,
        size: file.size,
        type: file.type,
        dataUrl: await fileToDataUrl(file),
      })
    }
    if (added.length) setImages((prev) => [...prev, ...added])
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files)
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) void addFiles(e.target.files)
    e.target.value = '' // so picking the same file twice still fires
  }

  /* paste an image straight from the clipboard */
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length) void addFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  /* ---------- models ---------- */

  async function refreshModels() {
    if (!apiKey.trim()) {
      setModelsNote('paste a key first')
      return
    }
    setModelsNote('loading…')
    try {
      const ids = await listModels(transport, apiKey.trim())
      const list = ids.length ? ids : DEFAULT_MODELS
      setModels(list)
      // the chosen model may be missing from this account's list: keep it as a custom id
      if (!list.includes(model)) setCustomModel(true)
      setModelsNote(`${list.length} models`)
    } catch (err) {
      setModelsNote(err instanceof Error ? err.message : String(err))
    }
  }

  /* ---------- send ---------- */

  async function send() {
    if (!apiKey.trim()) {
      setTab('text')
      setText('Paste your API key first.')
      return
    }

    const body = buildBody({ model, prompt, images, detail, maxTokens, temperature, effort })
    setRequest(`POST ${baseUrl(transport)}/v1/chat/completions\n\n${previewBody(body)}`)

    const controller = new AbortController()
    abort.current = controller
    setSending(true)
    setStatus('sending…')
    setOk(null)
    setUsage('—')
    setElapsed('—')
    setTab('text')
    setText('Waiting for the API…')
    const t0 = performance.now()

    try {
      const res = await fetch(`${baseUrl(transport)}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const bodyText = await res.text()
      setElapsed(`${Math.round(performance.now() - t0)} ms`)
      setStatus(`${res.status} ${res.statusText}`)
      setOk(res.ok)

      let json: unknown = null
      try {
        json = JSON.parse(bodyText)
      } catch {
        /* not JSON: the Raw tab still shows whatever came back */
      }
      setRaw(json ? JSON.stringify(json, null, 2) : bodyText)
      setText(json ? extractText(json) : bodyText || '(empty response)')
      setUsage(json ? usageLine(json) : '—')
      if (!res.ok) setTab('raw')
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      setStatus(aborted ? 'stopped' : 'network error')
      setOk(false)
      setElapsed(`${Math.round(performance.now() - t0)} ms`)
      setText(
        aborted ? 'Stopped.' : `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setSending(false)
      abort.current = null
    }
  }

  const output = tab === 'text' ? text : tab === 'raw' ? raw : request

  return (
    <div className="page">
      <header>
        <h1>ChatGPT API tester</h1>
        <p>POST /v1/chat/completions — key, model, images, prompt.</p>
      </header>

      <section className="card">
        <h2>Connection</h2>
        <div className="grid">
          <label className="field wide">
            <span>API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="field">
            <span>Request path</span>
            <select value={transport} onChange={(e) => setTransport(e.target.value as Transport)}>
              <option value="proxy">Vite proxy /openai (no CORS)</option>
              <option value="direct">Direct to api.openai.com</option>
            </select>
          </label>

          <label className="field">
            <span>
              Model
              <button className="link" onClick={refreshModels}>
                load from API
              </button>
              {modelsNote && <em className="note">{modelsNote}</em>}
            </span>
            <select
              value={customModel ? CUSTOM : model}
              onChange={(e) => {
                const v = e.target.value
                setCustomModel(v === CUSTOM)
                if (v !== CUSTOM) setModel(v)
              }}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value={CUSTOM}>Custom — type the model id</option>
            </select>
            {customModel && (
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                spellCheck={false}
                placeholder="gpt-4o-2024-11-20"
                autoFocus
              />
            )}
          </label>

          <label className="field">
            <span>Image detail</span>
            <select value={detail} onChange={(e) => setDetail(e.target.value as Detail)}>
              <option value="auto">auto (field omitted)</option>
              <option value="low">low — cheapest</option>
              <option value="high">high — most tokens</option>
            </select>
          </label>

          <label className="field">
            <span>Max output tokens</span>
            <input
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              inputMode="numeric"
              placeholder="empty = model default"
            />
          </label>

          <label className="field">
            <span>Temperature</span>
            <input
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              inputMode="decimal"
              placeholder="empty = omit (gpt-5 needs this)"
            />
          </label>

          <label className="field">
            <span>Reasoning effort</span>
            <select value={effort} onChange={(e) => setEffort(e.target.value)}>
              {EFFORTS.map((e) => (
                <option key={e || 'default'} value={e}>
                  {e === '' ? 'default (field omitted)' : e}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="note">
          Reasoning effort applies to gpt-5 and the o-series only. On those models, low or
          minimal leaves more of the token budget for the actual answer; other models reject
          the field.
        </p>

        <label className="check">
          <input
            type="checkbox"
            checked={rememberKey}
            onChange={(e) => setRememberKey(e.target.checked)}
          />
          Remember the key in this browser (localStorage, plain text)
        </label>
      </section>

      <section className="card">
        <h2>Images</h2>
        <div
          className={dragging ? 'drop over' : 'drop'}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInput.current?.click()}
        >
          Drop images here, paste from the clipboard, or click to choose files.
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={onPick} />
        </div>

        {images.length > 0 && (
          <>
            <div className="thumbs">
              {images.map((img) => (
                <figure key={img.id}>
                  <img src={img.dataUrl} alt={img.name} />
                  <figcaption title={img.name}>
                    {img.name}
                    <br />
                    <small>{fmtBytes(img.size)}</small>
                  </figcaption>
                  <button
                    className="x"
                    title="remove"
                    onClick={() => setImages((prev) => prev.filter((i) => i.id !== img.id))}
                  >
                    ×
                  </button>
                </figure>
              ))}
            </div>
            <p className="note">
              {images.length} image{images.length === 1 ? '' : 's'} —{' '}
              <button className="link" onClick={() => setImages([])}>
                remove all
              </button>
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h2>Prompt</h2>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} />
        <div className="actions">
          <button className="primary" onClick={send} disabled={sending}>
            {sending ? 'Sending…' : 'Send request'}
          </button>
          <button onClick={() => abort.current?.abort()} disabled={!sending}>
            Stop
          </button>
          <button
            onClick={() => {
              setText('Ready.')
              setRaw('')
              setRequest('')
              setStatus('idle')
              setElapsed('—')
              setUsage('—')
              setOk(null)
            }}
          >
            Clear output
          </button>
        </div>
      </section>

      <section className="card">
        <div className="statusbar">
          <span>
            Status: <b className={ok === null ? '' : ok ? 'good' : 'bad'}>{status}</b>
          </span>
          <span>
            Time: <b>{elapsed}</b>
          </span>
          <span>
            Tokens: <b>{usage}</b>
          </span>
        </div>

        <div className="tabs">
          <button aria-selected={tab === 'text'} onClick={() => setTab('text')}>
            Response
          </button>
          <button aria-selected={tab === 'raw'} onClick={() => setTab('raw')}>
            Raw JSON
          </button>
          <button aria-selected={tab === 'request'} onClick={() => setTab('request')}>
            Request sent
          </button>
          <button
            className="link right"
            onClick={() => void navigator.clipboard.writeText(output)}
            disabled={!output}
          >
            copy
          </button>
        </div>

        <pre className="out">{output || '(nothing yet)'}</pre>
      </section>
    </div>
  )
}
