/** Base URL for Loop API (empty = same origin / Vite proxy) */
export function apiBase(): string {
  const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
  return base.replace(/\/$/, '')
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string
    code?: string
  }

  if (!res.ok) {
    const err = new Error(data.error || `API ${res.status}`) as Error & {
      status?: number
      code?: string
    }
    err.status = res.status
    err.code = data.code
    throw err
  }

  return data
}

export interface ApiHealth {
  ok: boolean
  xai: boolean
  /** Grok TTS available (same key as xAI today) */
  tts?: boolean
  ors: boolean
  model: string
}

export function fetchHealth(): Promise<ApiHealth> {
  return apiFetch<ApiHealth>('/api/health')
}
