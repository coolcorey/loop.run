/**
 * Voice coach playback.
 * - Default: free browser Web Speech API (SpeechSynthesis)
 * - Optional: Grok AI TTS via POST /api/tts (Settings → AI voice, default off)
 *
 * See docs/VOICE.md
 */

import { apiBase } from '@/services/api'

export interface SpeakOptions {
  /** 0.5–2, default 1 (clear outdoors) */
  rate?: number
  /** 0–2, default 1 */
  pitch?: number
  /** 0–1, default 1 (max) */
  volume?: number
  lang?: string
  /** Interrupt current utterance (default true for live cues) */
  interrupt?: boolean
  /**
   * Force AI TTS (true) or browser (false).
   * When omitted, uses guest profile / configureVoice().
   */
  ai?: boolean
  /** Grok voice id: eve | ara | leo | rex | sal */
  voiceId?: string
}

export type VoiceProvider = 'browser' | 'ai'

/** Runtime prefs (set from guest store so speak() stays simple) */
let preferAi = false
let defaultVoiceId = 'eve'

export function configureVoice(opts: {
  aiVoice?: boolean
  voiceId?: string
}): void {
  if (typeof opts.aiVoice === 'boolean') preferAi = opts.aiVoice
  if (opts.voiceId) defaultVoiceId = opts.voiceId
}

export function isAiVoicePreferred(): boolean {
  return preferAi
}

let focusAudio: HTMLAudioElement | null = null
let audioCtx: AudioContext | null = null
let currentAiAudio: HTMLAudioElement | null = null
let speakGeneration = 0

/** Session cache: voiceId|speed|text → object URL */
const aiCache = new Map<string, string>()
const AI_CACHE_MAX = 48

export function isBrowserSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Browser speech or HTML Audio (for AI TTS) */
export function isSpeechSupported(): boolean {
  return (
    isBrowserSpeechSupported() ||
    (typeof window !== 'undefined' && typeof Audio !== 'undefined')
  )
}

/** Some engines load voices async (Chrome). Safe to call repeatedly. */
export function warmVoices(): void {
  if (!isBrowserSpeechSupported()) return
  window.speechSynthesis.getVoices()
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices()
  }
}

/**
 * Tiny silent WAV — used to poke the audio session / focus on mobile.
 */
function ensureFocusAudio(): HTMLAudioElement {
  if (focusAudio) return focusAudio
  const wav =
    'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
  const a = new Audio(wav)
  a.loop = false
  a.volume = 0.01
  a.setAttribute('playsinline', 'true')
  focusAudio = a
  return a
}

async function claimAudioFocus(): Promise<void> {
  try {
    const nav = navigator as Navigator & {
      audioSession?: { type: string }
    }
    if (nav.audioSession) {
      nav.audioSession.type = 'transient'
    }
  } catch {
    // ignore
  }

  try {
    if (!audioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      if (Ctx) audioCtx = new Ctx()
    }
    if (audioCtx?.state === 'suspended') {
      await audioCtx.resume()
    }
  } catch {
    // ignore
  }

  try {
    const a = ensureFocusAudio()
    a.currentTime = 0
    await a.play()
    window.setTimeout(() => {
      try {
        a.pause()
      } catch {
        /* */
      }
    }, 80)
  } catch {
    // autoplay rules
  }
}

/**
 * Call once from a user gesture (e.g. Start run) so mobile browsers allow audio.
 */
export function unlockSpeech(): void {
  try {
    void claimAudioFocus()
    if (isBrowserSpeechSupported()) {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 1
      u.rate = 2
      window.speechSynthesis.speak(u)
      window.speechSynthesis.cancel()
    }
    // Prime AI path Audio element
    if (!currentAiAudio) {
      currentAiAudio = new Audio()
      currentAiAudio.setAttribute('playsinline', 'true')
    }
  } catch {
    // ignore
  }
}

export function stopSpeaking(): void {
  speakGeneration++
  if (isBrowserSpeechSupported()) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* */
    }
  }
  if (currentAiAudio) {
    try {
      currentAiAudio.pause()
      currentAiAudio.removeAttribute('src')
      currentAiAudio.load()
    } catch {
      /* */
    }
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function cacheKey(voiceId: string, speed: number, text: string): string {
  return `${voiceId}|${speed.toFixed(2)}|${text}`
}

function rememberCache(key: string, url: string): void {
  if (aiCache.has(key)) return
  if (aiCache.size >= AI_CACHE_MAX) {
    const first = aiCache.keys().next().value
    if (first) {
      const old = aiCache.get(first)
      aiCache.delete(first)
      if (old) URL.revokeObjectURL(old)
    }
  }
  aiCache.set(key, url)
}

async function fetchAiAudio(
  text: string,
  voiceId: string,
  speed: number,
): Promise<string> {
  const key = cacheKey(voiceId, speed, text)
  const hit = aiCache.get(key)
  if (hit) return hit

  const url = `${apiBase()}/api/tts`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voiceId,
      speed,
    }),
    signal: AbortSignal.timeout(25_000),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; code?: string }
    throw new Error(err.error || `TTS ${res.status}`)
  }
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  rememberCache(key, objectUrl)
  return objectUrl
}

async function speakAi(text: string, options: SpeakOptions): Promise<void> {
  const gen = speakGeneration
  const rate = clamp(options.rate ?? 1, 0.7, 1.5)
  const voiceId = (options.voiceId || defaultVoiceId || 'eve').toLowerCase()
  const volume = clamp(options.volume ?? 1, 0, 1)

  await claimAudioFocus()
  if (gen !== speakGeneration) return

  const src = await fetchAiAudio(text, voiceId, rate)
  if (gen !== speakGeneration) return

  if (!currentAiAudio) {
    currentAiAudio = new Audio()
    currentAiAudio.setAttribute('playsinline', 'true')
  }
  const audio = currentAiAudio
  audio.pause()
  audio.volume = volume
  // playbackRate only if we want extra speed beyond server; server already got speed
  audio.playbackRate = 1
  audio.src = src
  try {
    await audio.play()
  } catch {
    // fall back to browser if AI play fails
    if (gen === speakGeneration) speakBrowser(text, options)
  }
}

function speakBrowser(text: string, options: SpeakOptions): boolean {
  if (!isBrowserSpeechSupported()) return false

  const {
    rate = 1,
    pitch = 1,
    volume = 1,
    lang = 'en-US',
    interrupt = true,
  } = options

  void claimAudioFocus()

  if (interrupt) {
    window.speechSynthesis.cancel()
  }

  const u = new SpeechSynthesisUtterance(text)
  u.rate = clamp(rate, 0.5, 2)
  u.pitch = clamp(pitch, 0, 2)
  u.volume = clamp(volume, 0, 1)
  u.lang = lang

  const voices = window.speechSynthesis.getVoices()
  const preferred =
    voices.find((v) => v.lang.startsWith('en') && v.localService) ||
    voices.find((v) => v.lang.startsWith('en'))
  if (preferred) u.voice = preferred

  window.setTimeout(() => {
    try {
      window.speechSynthesis.speak(u)
    } catch {
      // ignore
    }
  }, 40)

  return true
}

/**
 * Speak coach text. Uses AI TTS when enabled (and available), else browser synth.
 * Always returns quickly; AI path loads audio in the background.
 */
export function speak(text: string, options: SpeakOptions = {}): boolean {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return false

  const useAi = options.ai ?? preferAi
  const interrupt = options.interrupt !== false

  if (interrupt) {
    stopSpeaking()
  } else {
    speakGeneration++
  }

  if (useAi) {
    void speakAi(cleaned, options).catch(() => {
      // Network / no key → browser fallback
      speakBrowser(cleaned, options)
    })
    return true
  }

  return speakBrowser(cleaned, options)
}

export const AI_VOICE_OPTIONS = [
  { id: 'eve', label: 'Eve', blurb: 'Default, clear' },
  { id: 'ara', label: 'Ara', blurb: 'Warm' },
  { id: 'leo', label: 'Leo', blurb: 'Steady' },
  { id: 'rex', label: 'Rex', blurb: 'Bold' },
  { id: 'sal', label: 'Sal', blurb: 'Bright' },
] as const
