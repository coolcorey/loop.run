/**
 * Browser TTS via Web Speech API (SpeechSynthesis).
 * Free, on-device. See docs/VOICE.md for cloud upgrade path.
 */

export interface SpeakOptions {
  /** 0.5–2, default 1.05 (slightly brisk for coaching) */
  rate?: number
  /** 0–2, default 1 */
  pitch?: number
  /** 0–1 */
  volume?: number
  lang?: string
  /** Interrupt current utterance (default true for live cues) */
  interrupt?: boolean
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Some engines load voices async (Chrome). Safe to call repeatedly. */
export function warmVoices(): void {
  if (!isSpeechSupported()) return
  window.speechSynthesis.getVoices()
  // Chrome fires this once voices are ready
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices()
  }
}

/**
 * Call once from a user gesture (e.g. Start run) so mobile browsers allow audio.
 */
export function unlockSpeech(): void {
  if (!isSpeechSupported()) return
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0.01
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
    rate = 1.05,
    pitch = 1,
    volume = 1,
    lang = 'en-US',
    interrupt = true,
  } = options

  if (interrupt) {
    window.speechSynthesis.cancel()
  }

  const u = new SpeechSynthesisUtterance(cleaned)
  u.rate = clamp(rate, 0.5, 2)
  u.pitch = clamp(pitch, 0, 2)
  u.volume = clamp(volume, 0, 1)
  u.lang = lang

  // Prefer a local English voice when available
  const voices = window.speechSynthesis.getVoices()
  const preferred =
    voices.find((v) => v.lang.startsWith('en') && v.localService) ||
    voices.find((v) => v.lang.startsWith('en'))
  if (preferred) u.voice = preferred

  window.speechSynthesis.speak(u)
  return true
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
