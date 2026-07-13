import { env } from './env.js'

export class XaiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = 'XaiError'
  }
}

export function xaiConfigured(): boolean {
  return Boolean(env('XAI_API_KEY'))
}

export async function xaiChat(options: {
  system: string
  user: string
  temperature?: number
  json?: boolean
  model?: string
}): Promise<string> {
  const apiKey = env('XAI_API_KEY')
  if (!apiKey) {
    throw new XaiError('XAI_API_KEY is not set on the server')
  }

  const base = env('XAI_BASE_URL', 'https://api.x.ai/v1').replace(/\/$/, '')
  const model = options.model || env('XAI_MODEL', 'grok-4.3')

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
    temperature: options.temperature ?? 0.6,
  }
  if (options.json) {
    body.response_format = { type: 'json_object' }
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new XaiError(
      `xAI error ${res.status}: ${text.slice(0, 400)}`,
      res.status,
    )
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new XaiError('Empty xAI response')
  return content
}

export function parseJsonLoose<T>(text: string): T {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed) as T
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as T
    }
    throw new XaiError('Model did not return valid JSON')
  }
}

/** Grok TTS — raw audio bytes (default MP3). Never call from the browser with the API key. */
export async function xaiTts(options: {
  text: string
  voiceId?: string
  language?: string
  /** 0.7–1.5 */
  speed?: number
}): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const apiKey = env('XAI_API_KEY')
  if (!apiKey) {
    throw new XaiError('XAI_API_KEY is not set on the server')
  }

  const text = options.text.replace(/\s+/g, ' ').trim()
  if (!text) throw new XaiError('TTS text is empty')
  if (text.length > 1500) {
    throw new XaiError('TTS text too long for coach cues (max 1500 chars)')
  }

  const base = env('XAI_BASE_URL', 'https://api.x.ai/v1').replace(/\/$/, '')
  const voiceId = (options.voiceId || env('XAI_TTS_VOICE', 'eve')).toLowerCase()
  let speed = options.speed ?? 1
  speed = Math.min(1.5, Math.max(0.7, speed))

  const res = await fetch(`${base}/tts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      voice_id: voiceId,
      language: options.language || 'en',
      speed,
      output_format: {
        codec: 'mp3',
        sample_rate: 24000,
        bit_rate: 128000,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new XaiError(
      `xAI TTS error ${res.status}: ${errText.slice(0, 400)}`,
      res.status,
    )
  }

  const contentType = res.headers.get('content-type') || 'audio/mpeg'
  const bytes = await res.arrayBuffer()
  if (!bytes.byteLength) throw new XaiError('Empty TTS audio')
  return { bytes, contentType }
}
