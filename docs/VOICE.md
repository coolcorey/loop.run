# Voice coaching — current + upgrade path

Loop speaks **coach nudges** and **turn cues** during a run. This doc describes what ships now and how to upgrade voice quality later without rewriting the product.

---

## Now (shipped): browser TTS

**API:** [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis) (`speechSynthesis`)  
**Code:** `src/services/voice.ts`  
**Settings:** voice on/off, coach lines, turn cues, speech rate  
**Cost:** **$0** for audio (on-device). Grok text nudges still cost normal LLM tokens (usually fractions of a cent per run).

### Behavior

| Cue | When | Notes |
|-----|------|--------|
| Coach nudge | After AI/mock nudge (interval + “Nudge me”) | Interrupted if a newer cue fires |
| Turn | First time a turn enters announce range | Deduped per turn instruction until you leave range |
| Unlock | User taps **Start run** | Required on many mobile browsers |

### Limits (known)

- Sounds depend on OS/browser voices (iOS generally better).
- Screen lock / background tabs often **pause** speech (same PWA limits as GPS).
- Not as natural as neural cloud TTS.

### Keep screen on (companion setting)

**Settings → During a run → Keep screen on** uses the [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) while a run is active (`src/services/wakeLock.ts`).

That keeps the phone unlocked/display on so GPS + speaker stay in the reliable “foreground” path. Default **on**; turn off to save battery. Does **not** enable true lock-screen / background tracking (still needs native later).

### Toggle path

Guest profile fields (`loop.guest` in localStorage):

- `voiceEnabled` — master
- `voiceCoach` / `voiceTurns` — categories
- `voiceRate` — 0.5–2

All speak calls should go through `speak()` in `voice.ts` so a later provider can sit behind the same facade.

---

## Later: cloud TTS (premium voice)

Keep generating short text the same way. Swap only the **audio renderer**.

### Architecture

```
coachNudge / turn text
        │
        ▼
  speak(text)  ──►  [now] SpeechSynthesis
               ──►  [later] POST /api/tts → audio URL/blob → <audio>
```

Suggested server endpoint:

```
POST /api/tts
{ "text": "Hold this pace.", "voice": "default" }
→ { "audioUrl": "…" } or audio/mpeg body
```

- **Never** put TTS API keys in `VITE_*` env vars (same rule as xAI chat).
- Cache identical strings (phrase bank) in memory or object storage → cost collapses.

### Provider options (approx. pricing)

| Provider | Ballpark | Notes |
|----------|----------|--------|
| **xAI TTS** | ~$4–15 / 1M characters (check current console) | Same vendor as Grok |
| **OpenAI TTS** | ~$15 / 1M standard, ~$30 / 1M HD | Easy API |
| **Google / Azure / Polly** | often ~$4–16 / 1M neural | Good at scale |
| **ElevenLabs etc.** | higher | Overkill for short cues |

### Cost sketch for Loop

Assume ~50 characters per spoken line, ~20 lines per run, **$15 / 1M chars**:

| Volume | Chars | TTS cost |
|--------|-------|----------|
| 1 run | ~1,000 | ~$0.015 |
| 100 runs / mo | ~100k | ~$1.50 |
| 1k users × 10 runs | ~10M | ~$150 / mo |

With caching of stock lines (“Ease in”, “Hold this”, “Last stretch”), most audio is free after first synthesis.

### Implementation checklist (when ready)

1. Add `POST /api/tts` in `server/` with `XAI_API_KEY` or dedicated TTS key.
2. Extend `src/services/voice.ts`:
   - `VITE_VOICE_PROVIDER=browser|cloud` (or settings toggle “Premium voice”).
   - Browser path unchanged; cloud path fetches audio and plays via `Audio()`.
3. Client-side cache: `Map<text, blobUrl>` or Cache API for the session / IndexedDB.
4. Keep **interrupt** semantics: stop previous `Audio` when a new cue fires.
5. Optional: pre-generate common coach tones offline during build.

### Not recommended for Loop v1–v2

**Realtime speech-to-speech / always-on voice agents** (~$/hour session time).  
Loop needs short intermittent cues, not a continuous conversation channel.

---

## Phrase design (any provider)

- Prefer **≤12 words**.
- One idea per cue (pace **or** turn, not both).
- Rate-limit coach (already ~45s); turns only on enter-range.
- Avoid repeating the same coach line twice in a row (optional: hash last spoken text).

---

## Related files

| File | Role |
|------|------|
| `src/services/voice.ts` | Speak / stop / unlock |
| `src/views/RunView.vue` | Wires cues during a run |
| `src/views/SettingsView.vue` | User toggles |
| `src/stores/guest.ts` | Persisted prefs |
| `server/xai.ts` | Chat only today; TTS can share key later |
