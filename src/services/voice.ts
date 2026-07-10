/**
 * Browser TTS via Web Speech API (SpeechSynthesis).
 * Free, on-device. See docs/VOICE.md for cloud upgrade path.
 *
 * Outdoor / music: we speak at full volume and try to claim a short-lived
 * audio focus so cues cut through better. OS mixers still vary by browser.
 */

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
}

let focusAudio: HTMLAudioElement | null = null
let audioCtx: AudioContext | null = null

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Some engines load voices async (Chrome). Safe to call repeatedly. */
export function warmVoices(): void {
  if (!isSpeechSupported()) return
  window.speechSynthesis.getVoices()
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices()
  }
}

/**
 * Tiny silent WAV — used to poke the audio session / focus on mobile.
 * Not a guarantee of ducking, but helps some Android/Chrome stacks.
 */
function ensureFocusAudio(): HTMLAudioElement {
  if (focusAudio) return focusAudio
  // Minimal valid silent wav
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
    // Experimental: prefer transient (notification-like) over long media
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
    // stop quickly — we only wanted focus
    window.setTimeout(() => {
      try {
        a.pause()
      } catch {
        /* */
      }
    }, 80)
  } catch {
    // autoplay rules — unlockSpeech from a gesture should have primed this
  }
}

/**
 * Call once from a user gesture (e.g. Start run) so mobile browsers allow audio.
 */
export function unlockSpeech(): void {
  if (!isSpeechSupported()) return
  try {
    void claimAudioFocus()
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 1
    u.rate = 2
    window.speechSynthesis.speak(u)
    window.speechSynthesis.cancel()
  } catch {
    // ignore
  }
}

export function stopSpeaking(): void {
  if (!isSpeechSupported()) return
  window.speechSynthesis.cancel()
}

export function speak(text: string, options: SpeakOptions = {}): boolean {
  if (!isSpeechSupported()) return false
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return false

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

  const u = new SpeechSynthesisUtterance(cleaned)
  // Full volume — browsers clamp to 1
  u.rate = clamp(rate, 0.5, 2)
  u.pitch = clamp(pitch, 0, 2)
  u.volume = clamp(volume, 0, 1)
  u.lang = lang

  const voices = window.speechSynthesis.getVoices()
  const preferred =
    voices.find((v) => v.lang.startsWith('en') && v.localService) ||
    voices.find((v) => v.lang.startsWith('en'))
  if (preferred) u.voice = preferred

  // Slight pause after focus grab so some mixers apply ducking
  window.setTimeout(() => {
    try {
      window.speechSynthesis.speak(u)
    } catch {
      // ignore
    }
  }, 40)

  return true
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
