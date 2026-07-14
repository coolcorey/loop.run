/**
 * Voice coach playback.
 * - Default: free browser Web Speech API (SpeechSynthesis)
 * - Optional: Grok AI TTS via POST /api/tts (Settings → AI voice, default off)
 *
 * AI cues play through Web Audio (not HTMLMediaElement) and request a
 * transient audio session so background music is ducked/mixed, not stopped.
 * Browser synth already behaves that way on most OS/browsers.
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

let audioCtx: AudioContext | null = null
let currentSource: AudioBufferSourceNode | null = null
let speakGeneration = 0

/** Session cache: voiceId|speed|text → raw MP3 bytes */
const aiCache = new Map<string, ArrayBuffer>()
const AI_CACHE_MAX = 48

export function isBrowserSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Browser speech or Web Audio (for AI TTS) */
export function isSpeechSupported(): boolean {
  return (
    isBrowserSpeechSupported() ||
    (typeof window !== 'undefined' &&
      (typeof AudioContext !== 'undefined' ||
        typeof (
          window as unknown as { webkitAudioContext?: unknown }
        ).webkitAudioContext !== 'undefined'))
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

type AudioSessionType =
  | 'auto'
  | 'playback'
  | 'transient'
  | 'transient-solo'
  | 'ambient'

/**
 * Prefer mix-friendly session so coach cues don't kill Spotify etc.
 * - transient: short cue, may duck music (best for coach lines)
 * - ambient: mix without taking over (fallback)
 * Never use "playback" for AI TTS — that pauses other media.
 */
function setAudioSession(type: AudioSessionType): void {
  try {
    const nav = navigator as Navigator & {
      audioSession?: { type: string }
    }
    if (nav.audioSession) {
      nav.audioSession.type = type
    }
  } catch {
    // ignore
  }
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  return (
    window.AudioContext ||
    (
      window as unknown as { webkitAudioContext?: typeof AudioContext }
    ).webkitAudioContext ||
    null
  )
}

async function ensureAudioCtx(): Promise<AudioContext> {
  const Ctor = getAudioContextCtor()
  if (!Ctor) throw new Error('Web Audio unavailable')
  if (!audioCtx) {
    audioCtx = new Ctor()
  }
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume()
  }
  return audioCtx
}

function stopAiWebAudio(): void {
  if (currentSource) {
    try {
      currentSource.onended = null
      currentSource.stop()
    } catch {
      /* already stopped */
    }
    try {
      currentSource.disconnect()
    } catch {
      /* */
    }
    currentSource = null
  }
}

/**
 * Call once from a user gesture (e.g. Start run) so mobile browsers allow audio.
 * Does not play HTML media (that can pause background music).
 */
export function unlockSpeech(): void {
  try {
    setAudioSession('transient')
    const Ctor = getAudioContextCtor()
    if (Ctor) {
      if (!audioCtx) audioCtx = new Ctor()
      void audioCtx.resume()
    }
    if (isBrowserSpeechSupported()) {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0.01
      u.rate = 2
      window.speechSynthesis.speak(u)
      window.speechSynthesis.cancel()
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
  stopAiWebAudio()
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function cacheKey(voiceId: string, speed: number, text: string): string {
  return `${voiceId}|${speed.toFixed(2)}|${text}`
}

function rememberCache(key: string, bytes: ArrayBuffer): void {
  if (aiCache.has(key)) return
  if (aiCache.size >= AI_CACHE_MAX) {
    const first = aiCache.keys().next().value
    if (first) aiCache.delete(first)
  }
  aiCache.set(key, bytes)
}

async function fetchAiBytes(
  text: string,
  voiceId: string,
  speed: number,
): Promise<ArrayBuffer> {
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
    const err = (await res.json().catch(() => ({}))) as {
      error?: string
      code?: string
    }
    throw new Error(err.error || `TTS ${res.status}`)
  }
  const bytes = await res.arrayBuffer()
  rememberCache(key, bytes)
  return bytes
}

/**
 * Play AI TTS via Web Audio so we don't take HTMLMediaElement "music" focus.
 * decodeAudioData detaches the buffer — always pass a copy.
 */
async function speakAi(text: string, options: SpeakOptions): Promise<void> {
  const gen = speakGeneration
  const rate = clamp(options.rate ?? 1, 0.7, 1.5)
  const voiceId = (options.voiceId || defaultVoiceId || 'eve').toLowerCase()
  const volume = clamp(options.volume ?? 1, 0, 1)

  // Duck / mix — do not claim playback focus
  setAudioSession('transient')

  const bytes = await fetchAiBytes(text, voiceId, rate)
  if (gen !== speakGeneration) return

  const ctx = await ensureAudioCtx()
  if (gen !== speakGeneration) return

  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(bytes.slice(0))
  } catch {
    // Rare decode failure — last resort HTMLAudio with transient session
    await speakAiHtmlFallback(bytes, volume, gen, text, options)
    return
  }
  if (gen !== speakGeneration) return

  stopAiWebAudio()

  const gain = ctx.createGain()
  gain.gain.value = volume
  gain.connect(ctx.destination)

  const source = ctx.createBufferSource()
  source.buffer = decoded
  source.connect(gain)
  currentSource = source

  source.onended = () => {
    if (currentSource === source) currentSource = null
    try {
      source.disconnect()
      gain.disconnect()
    } catch {
      /* */
    }
    // Release transient claim so music stays primary
    setAudioSession('auto')
  }

  try {
    source.start(0)
  } catch {
    if (gen === speakGeneration) speakBrowser(text, options)
  }
}

/** Only if Web Audio decode fails — still force transient session. */
async function speakAiHtmlFallback(
  bytes: ArrayBuffer,
  volume: number,
  gen: number,
  text: string,
  options: SpeakOptions,
): Promise<void> {
  setAudioSession('transient')
  const blob = new Blob([bytes], { type: 'audio/mpeg' })
  const url = URL.createObjectURL(blob)
  const audio = new Audio()
  audio.setAttribute('playsinline', 'true')
  // Hint: not a full media playback session where supported
  ;(audio as HTMLAudioElement & { disableRemotePlayback?: boolean }).disableRemotePlayback =
    true
  audio.volume = volume
  audio.src = url
  const cleanup = () => {
    URL.revokeObjectURL(url)
    setAudioSession('auto')
  }
  audio.addEventListener('ended', cleanup)
  audio.addEventListener('error', cleanup)
  try {
    if (gen !== speakGeneration) {
      cleanup()
      return
    }
    await audio.play()
  } catch {
    cleanup()
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

  // Synth path — don't poke HTML media focus
  setAudioSession('transient')

  if (interrupt) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* */
    }
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
