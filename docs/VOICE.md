# Voice coaching

Loop speaks **coach nudges** and **turn cues** during a run.

---

## Default: browser TTS (free)

**API:** [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)  
**Code:** `src/services/voice.ts`  
**Settings:** Voice on/off, coach, turns, rate  
**Cost:** **$0** for audio (on-device).

### Limits

- Sounds depend on OS/browser voices.
- Background tabs often pause speech.
- Less natural than neural TTS.

---

## Optional: AI voice (Grok TTS) — default **off**

**Settings → Voice coach → AI voice On**

Uses the same server key as chat (`XAI_API_KEY`). Client never sees the key.

```
coach text → speak() → POST /api/tts → Grok /v1/tts → MP3 → <audio>
                 ↘ (fail) browser SpeechSynthesis
```

| Piece | Role |
|-------|------|
| `POST /api/tts` | Server proxy (`server/index.ts` + `xaiTts`) |
| `guest.profile.aiVoice` | Preference, **default false** |
| `guest.profile.aiVoiceId` | `eve` / `ara` / `leo` / `rex` / `sal` |
| Session cache | Identical lines reused (no re-bill) |

### Cost (approx.)

~$15 / 1M characters. Short coach lines (~50 chars × 20 / run) ≈ **$0.015 / run** if nothing is cached.

### Env

```
XAI_API_KEY=...
# optional default character
# XAI_TTS_VOICE=eve
```

---

## Shared behavior

| Cue | When |
|-----|------|
| Coach nudge | Interval + “Nudge me” |
| Turn | Enter announce range |
| Unlock | **Start run** gesture (mobile autoplay) |

Guest fields: `voiceEnabled`, `voiceCoach`, `voiceTurns`, `voiceRate`, `aiVoice`, `aiVoiceId`.

All speak paths go through `speak()` so interrupt + provider stay consistent.

### Keep screen on

**Settings → Keep screen on** uses Screen Wake Lock during runs.

---

## Not for Loop v1–v2

Always-on speech-to-speech agents (hourly session cost). Loop needs short intermittent cues.
