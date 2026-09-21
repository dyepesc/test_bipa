/* Everything that talks to the OpenAI REST API lives here. */

export type ImageItem = {
  id: string
  name: string
  size: number
  type: string
  dataUrl: string // data:image/png;base64,....  <- what the API wants
}

export type Detail = 'auto' | 'low' | 'high'

/** 'proxy' goes through the Vite dev server (no CORS); 'direct' hits OpenAI from the browser. */
export type Transport = 'proxy' | 'direct'

export const baseUrl = (t: Transport) => (t === 'proxy' ? '/openai' : 'https://api.openai.com')

/** Models that accept images, newest first. The list is only a convenience —
 *  "Load from API" replaces it with whatever the key can actually see. */
export const DEFAULT_MODELS = [
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4o',
  'gpt-4o-mini',
  'o4-mini',
]

export type BodyOptions = {
  model: string
  prompt: string
  images: ImageItem[]
  detail: Detail
  maxTokens: string // empty string = leave the parameter out
  temperature: string // idem — gpt-5 / o-series only accept the default
  effort: string // idem — reasoning_effort, gpt-5 and the o-series only
}

/** '' keeps the parameter out of the body and lets the model use its default. */
export const EFFORTS = ['', 'minimal', 'low', 'medium', 'high']

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: Detail } }

/** Builds a POST /v1/chat/completions body: one user message, text first, then the images. */
export function buildBody(o: BodyOptions): Record<string, unknown> {
  const content: ContentPart[] = []
  if (o.prompt.trim()) content.push({ type: 'text', text: o.prompt })
  for (const img of o.images) {
    content.push({
      type: 'image_url',
      image_url: o.detail === 'auto' ? { url: img.dataUrl } : { url: img.dataUrl, detail: o.detail },
    })
  }

  const body: Record<string, unknown> = {
    model: o.model,
    messages: [{ role: 'user', content }],
  }
  if (o.maxTokens.trim()) body.max_completion_tokens = Number(o.maxTokens)
  if (o.temperature.trim()) body.temperature = Number(o.temperature)
  if (o.effort.trim()) body.reasoning_effort = o.effort
  return body
}

/** Same body, but every image shortened, so the Request tab stays readable. */
export function previewBody(body: Record<string, unknown>): string {
  const clone = JSON.parse(JSON.stringify(body)) as {
    messages?: { content?: ContentPart[] }[]
  }
  for (const msg of clone.messages ?? []) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part.type !== 'image_url') continue
      const url = part.image_url.url
      part.image_url.url = url.slice(0, 48) + `... <${url.length} chars>`
    }
  }
  return JSON.stringify(clone, null, 2)
}

type ChatResponse = {
  choices?: {
    message?: { content?: string | null; refusal?: string | null }
    finish_reason?: string
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    completion_tokens_details?: { reasoning_tokens?: number }
  }
  error?: { message?: string; type?: string; code?: string }
}

/* A 200 with empty content is the confusing case: the call worked, the model just
 * never got to the answer. Say which of the few reasons it was. */
function emptyAnswer(r: ChatResponse): string {
  const choice = r.choices?.[0]
  const refusal = choice?.message?.refusal
  if (refusal) return `The model refused to answer: ${refusal}`

  const reason = choice?.finish_reason
  const reasoning = r.usage?.completion_tokens_details?.reasoning_tokens ?? 0

  if (reason === 'length' && reasoning > 0) {
    return (
      `The model used the whole token budget on internal reasoning (${reasoning} reasoning ` +
      `tokens) and had none left for the answer.\n\n` +
      `Fix it with either:\n` +
      `  • a bigger "Max output tokens" — reasoning models need room, try 4000+\n` +
      `  • "Reasoning effort" set to minimal or low\n` +
      `  • a non-reasoning model such as gpt-4.1 or gpt-4o`
    )
  }
  if (reason === 'length') {
    return 'The answer hit the token limit before any text came out. Raise "Max output tokens".'
  }
  if (reason === 'content_filter') return 'The answer was blocked by the content filter.'
  if (!r.choices?.length) return 'The response has no choices at all — check the Raw tab.'
  return `The model returned an empty answer (finish_reason: ${reason ?? 'none'}) — check the Raw tab.`
}

/** Pulls the assistant text out of a chat completion, or an error message out of a failure. */
export function extractText(json: unknown): string {
  const r = json as ChatResponse
  if (r?.error?.message) return `API error: ${r.error.message}`
  const parts = (r?.choices ?? [])
    .map((c) => c.message?.content ?? '')
    .filter((t) => t.length > 0)
  if (parts.length) return parts.join('\n\n---\n\n')
  return emptyAnswer(r)
}

export function usageLine(json: unknown): string {
  const u = (json as ChatResponse)?.usage
  if (!u) return '—'
  const reasoning = u.completion_tokens_details?.reasoning_tokens
  const out =
    reasoning != null && reasoning > 0
      ? `${u.completion_tokens ?? '?'} out (${reasoning} reasoning)`
      : `${u.completion_tokens ?? '?'} out`
  return `${u.prompt_tokens ?? '?'} in / ${out} / ${u.total_tokens ?? '?'} total`
}

/** GET /v1/models, filtered to the chat models and sorted alphabetically. */
export async function listModels(transport: Transport, apiKey: string): Promise<string[]> {
  const res = await fetch(`${baseUrl(transport)}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const json = (await res.json()) as { data?: { id: string }[]; error?: { message?: string } }
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`)
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id) => /^(gpt|o\d|chatgpt)/.test(id))
    .sort()
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('could not read the file'))
    reader.readAsDataURL(file)
  })
}
