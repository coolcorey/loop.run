<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useGuestStore } from '@/stores/guest'
import { isPocketBaseConfigured } from '@/services/pocketbase'
import { ai } from '@/services/ai'
import { fetchHealth, type ApiHealth } from '@/services/api'
import {
  AI_VOICE_OPTIONS,
  isSpeechSupported,
  speak,
  unlockSpeech,
  warmVoices,
} from '@/services/voice'
import { isWakeLockSupported } from '@/services/wakeLock'
import { geoDiagnostics, getCurrentPosition, isSecureGeoContext } from '@/services/geo'
import { COACH_VOICE_OPTIONS } from '@/services/coachVoices'

const guest = useGuestStore()
const coachVoices = COACH_VOICE_OPTIONS
const pbReady = isPocketBaseConfigured()
const health = ref<ApiHealth | null>(null)
const healthError = ref<string | null>(null)
const speechOk = isSpeechSupported()
const wakeOk = isWakeLockSupported()
const geoLines = ref<string[]>([])
const geoTestMsg = ref<string | null>(null)

onMounted(async () => {
  warmVoices()
  geoLines.value = geoDiagnostics()
  try {
    health.value = await fetchHealth()
  } catch {
    healthError.value =
      'API offline. Run `npm run dev` (starts Vite + API) or `npm run dev:api`.'
  }
})

async function testLocation() {
  geoTestMsg.value = 'Requesting (max ~12s)…'
  const started = Date.now()
  try {
    const p = await getCurrentPosition({ maxWaitMs: 12_000, forceFresh: false })
    const ms = Date.now() - started
    geoTestMsg.value = `OK in ${ms}ms: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} (±${Math.round(p.accuracy ?? 0)}m)`
  } catch (e) {
    const ms = Date.now() - started
    geoTestMsg.value = `Failed after ${ms}ms — ${e instanceof Error ? e.message : 'Location failed'}`
  }
  geoLines.value = geoDiagnostics()
}

function testVoice() {
  unlockSpeech()
  warmVoices()
  speak(
    guest.profile.aiVoice
      ? 'Loop AI coach ready. Hold this pace.'
      : 'Loop coach ready. Hold this pace.',
    {
      rate: guest.profile.voiceRate,
      ai: guest.profile.aiVoice,
      voiceId: guest.profile.aiVoiceId,
    },
  )
}
</script>

<template>
  <section>
    <p class="lede" style="margin-top: 0">Guest defaults. Sync / accounts come later with PocketBase.</p>

    <div class="card stack">
      <div class="field">
        <label>Display name</label>
        <input
          :value="guest.profile.displayName"
          type="text"
          @input="guest.setDisplayName(($event.target as HTMLInputElement).value)"
        />
      </div>

      <div class="row">
        <span class="muted small">Distance unit</span>
        <div class="seg">
          <button
            type="button"
            :class="{ active: guest.unit === 'mi' }"
            @click="guest.setUnit('mi')"
          >
            mi
          </button>
          <button
            type="button"
            :class="{ active: guest.unit === 'km' }"
            @click="guest.setUnit('km')"
          >
            km
          </button>
        </div>
      </div>

      <div class="field">
        <label>Turn announce distance (meters)</label>
        <input
          :value="guest.profile.turnAnnounceMeters"
          type="number"
          min="15"
          max="200"
          @input="guest.setTurnAnnounceMeters(Number(($event.target as HTMLInputElement).value))"
        />
        <span class="muted small">Closer = later cues (default 40m, not 600ft).</span>
      </div>

      <div class="field">
        <label>Off-route threshold (meters)</label>
        <input
          :value="guest.profile.offRouteMeters"
          type="number"
          min="20"
          max="120"
          @input="guest.setOffRouteMeters(Number(($event.target as HTMLInputElement).value))"
        />
        <span class="muted small">How far from the path before “off route” (default 45m).</span>
      </div>

      <div class="field">
        <label>Weight (kg) — calorie estimates</label>
        <input
          :value="guest.profile.weightKg"
          type="number"
          min="30"
          max="250"
          step="0.5"
          @input="guest.setWeightKg(Number(($event.target as HTMLInputElement).value))"
        />
      </div>
    </div>

    <div class="card stack">
      <div class="card-title">Location</div>
      <p class="muted small" style="margin: 0">
        Browsers only share GPS on <strong>HTTPS</strong> or <strong>localhost</strong>.
        Phone over Wi‑Fi must use the <code>https://</code> URL from <code>npm run dev</code>
        (accept the certificate warning once).
      </p>
      <p class="small" :class="isSecureGeoContext() ? 'success' : 'error'" style="margin: 0">
        Secure context: {{ isSecureGeoContext() ? 'yes' : 'no — GPS blocked' }}
      </p>
      <ul class="muted small" style="margin: 0; padding-left: 1.1rem">
        <li v-for="(line, i) in geoLines" :key="i">{{ line }}</li>
      </ul>
      <button class="btn btn-ghost btn-block" type="button" @click="testLocation">
        Test location
      </button>
      <p v-if="geoTestMsg" class="small" style="margin: 0">{{ geoTestMsg }}</p>
    </div>

    <div class="card stack">
      <div class="card-title">During a run</div>
      <div class="row" style="justify-content: space-between">
        <div>
          <span class="small">Keep screen on</span>
          <p class="muted small" style="margin: 0.2rem 0 0; max-width: 14rem">
            Stops auto-lock so GPS and speaker keep working. Uses more battery.
            <template v-if="!wakeOk"> Not supported in this browser.</template>
          </p>
        </div>
        <div class="seg">
          <button
            type="button"
            :class="{ active: guest.profile.keepScreenOnDuringRun }"
            :disabled="!wakeOk"
            @click="guest.setKeepScreenOnDuringRun(true)"
          >
            On
          </button>
          <button
            type="button"
            :class="{ active: !guest.profile.keepScreenOnDuringRun }"
            @click="guest.setKeepScreenOnDuringRun(false)"
          >
            Off
          </button>
        </div>
      </div>
    </div>

    <div class="card stack">
      <div class="card-title">Coach &amp; AI</div>
      <p class="muted small" style="margin: 0">
        Quiet automation — no extra screens. Ideas list: <code>docs/AI_IDEAS.md</code>.
      </p>
      <div class="field">
        <label>Coach voice</label>
        <select
          :value="guest.profile.coachVoice"
          @change="guest.setCoachVoice(($event.target as HTMLSelectElement).value as any)"
        >
          <option v-for="o in coachVoices" :key="o.id" :value="o.id">
            {{ o.label }} — {{ o.blurb }}
          </option>
        </select>
      </div>
      <div class="row" style="justify-content: space-between">
        <div>
          <span class="small">Local color</span>
          <p class="muted small" style="margin: 0.15rem 0 0; max-width: 14rem">
            Occasional “look left…” bits using nearby place names (invented flavor in that voice).
          </p>
        </div>
        <div class="seg">
          <button type="button" :class="{ active: guest.profile.localColor }" @click="guest.setLocalColor(true)">On</button>
          <button type="button" :class="{ active: !guest.profile.localColor }" @click="guest.setLocalColor(false)">Off</button>
        </div>
      </div>
      <div class="field">
        <label>Athlete notes (injury, fatigue, prefs)</label>
        <textarea
          :value="guest.profile.athleteNotes"
          rows="2"
          placeholder="e.g. sore left Achilles, keep volume easy"
          @input="guest.setAthleteNotes(($event.target as HTMLTextAreaElement).value)"
        />
      </div>
      <div class="row" style="justify-content: space-between">
        <span class="small">Post-run debrief</span>
        <div class="seg">
          <button type="button" :class="{ active: guest.profile.autoDebrief }" @click="guest.setAutoDebrief(true)">On</button>
          <button type="button" :class="{ active: !guest.profile.autoDebrief }" @click="guest.setAutoDebrief(false)">Off</button>
        </div>
      </div>
      <div class="row" style="justify-content: space-between">
        <span class="small">Split commentary</span>
        <div class="seg">
          <button type="button" :class="{ active: guest.profile.autoSplitCommentary }" @click="guest.setAutoSplitCommentary(true)">On</button>
          <button type="button" :class="{ active: !guest.profile.autoSplitCommentary }" @click="guest.setAutoSplitCommentary(false)">Off</button>
        </div>
      </div>
      <div class="row" style="justify-content: space-between">
        <span class="small">Milestone cues (25/50/75%)</span>
        <div class="seg">
          <button type="button" :class="{ active: guest.profile.autoMilestones }" @click="guest.setAutoMilestones(true)">On</button>
          <button type="button" :class="{ active: !guest.profile.autoMilestones }" @click="guest.setAutoMilestones(false)">Off</button>
        </div>
      </div>
      <div class="row" style="justify-content: space-between">
        <span class="small">Session brief on start</span>
        <div class="seg">
          <button type="button" :class="{ active: guest.profile.autoSessionBrief }" @click="guest.setAutoSessionBrief(true)">On</button>
          <button type="button" :class="{ active: !guest.profile.autoSessionBrief }" @click="guest.setAutoSessionBrief(false)">Off</button>
        </div>
      </div>
    </div>

    <div class="card stack">
      <div class="card-title">Voice coach</div>
      <p class="muted small" style="margin: 0">
        Default is free browser speech. Optional AI voice uses Grok TTS (~$15 / 1M chars).
        <template v-if="!speechOk"> Not supported in this browser.</template>
      </p>

      <div class="row" style="justify-content: space-between">
        <span class="small">Voice on</span>
        <div class="seg">
          <button
            type="button"
            :class="{ active: guest.profile.voiceEnabled }"
            :disabled="!speechOk"
            @click="guest.setVoiceEnabled(true)"
          >
            On
          </button>
          <button
            type="button"
            :class="{ active: !guest.profile.voiceEnabled }"
            @click="guest.setVoiceEnabled(false)"
          >
            Off
          </button>
        </div>
      </div>

      <div class="row" style="justify-content: space-between">
        <span class="small">AI voice</span>
        <div class="seg">
          <button
            type="button"
            :class="{ active: guest.profile.aiVoice }"
            :disabled="!guest.profile.voiceEnabled || (health != null && health.tts === false)"
            @click="guest.setAiVoice(true)"
          >
            On
          </button>
          <button
            type="button"
            :class="{ active: !guest.profile.aiVoice }"
            :disabled="!guest.profile.voiceEnabled"
            @click="guest.setAiVoice(false)"
          >
            Off
          </button>
        </div>
      </div>
      <p class="muted small" style="margin: 0">
        Off = browser synth (free). On = Grok neural voice via server.
        <template v-if="health && !health.tts && !health.xai">
          Needs <code>XAI_API_KEY</code> on the API.
        </template>
      </p>

      <div v-if="guest.profile.aiVoice" class="field">
        <label>AI voice character</label>
        <div class="seg" style="flex-wrap: wrap">
          <button
            v-for="v in AI_VOICE_OPTIONS"
            :key="v.id"
            type="button"
            :class="{ active: guest.profile.aiVoiceId === v.id }"
            @click="guest.setAiVoiceId(v.id)"
          >
            {{ v.label }}
          </button>
        </div>
      </div>

      <div class="row" style="justify-content: space-between">
        <span class="small">Coach nudges</span>
        <div class="seg">
          <button
            type="button"
            :class="{ active: guest.profile.voiceCoach }"
            :disabled="!guest.profile.voiceEnabled"
            @click="guest.setVoiceCoach(true)"
          >
            On
          </button>
          <button
            type="button"
            :class="{ active: !guest.profile.voiceCoach }"
            :disabled="!guest.profile.voiceEnabled"
            @click="guest.setVoiceCoach(false)"
          >
            Off
          </button>
        </div>
      </div>

      <div class="row" style="justify-content: space-between">
        <span class="small">Turn cues</span>
        <div class="seg">
          <button
            type="button"
            :class="{ active: guest.profile.voiceTurns }"
            :disabled="!guest.profile.voiceEnabled"
            @click="guest.setVoiceTurns(true)"
          >
            On
          </button>
          <button
            type="button"
            :class="{ active: !guest.profile.voiceTurns }"
            :disabled="!guest.profile.voiceEnabled"
            @click="guest.setVoiceTurns(false)"
          >
            Off
          </button>
        </div>
      </div>

      <div class="field">
        <label>Speech rate ({{ guest.profile.voiceRate.toFixed(2) }})</label>
        <input
          :value="guest.profile.voiceRate"
          type="range"
          min="0.7"
          max="1.4"
          step="0.05"
          :disabled="!guest.profile.voiceEnabled"
          @input="guest.setVoiceRate(Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <button
        class="btn btn-ghost btn-block"
        type="button"
        :disabled="!speechOk || !guest.profile.voiceEnabled"
        @click="testVoice"
      >
        Test voice
      </button>
    </div>

    <div class="card">
      <div class="card-title">Integrations</div>
      <p class="small" style="margin: 0">
        Client AI facade: <strong>{{ ai.name }}</strong>
      </p>
      <template v-if="health">
        <p class="small success" style="margin: 0.35rem 0 0">API online</p>
        <p class="small muted" style="margin: 0.25rem 0 0">
          xAI: <strong>{{ health.xai ? 'key set' : 'missing XAI_API_KEY' }}</strong>
          · TTS: <strong>{{ (health.tts ?? health.xai) ? 'ready' : 'off' }}</strong>
          · model {{ health.model }}
        </p>
        <p class="small muted" style="margin: 0.25rem 0 0">
          OpenRouteService:
          <strong>{{ health.ors ? 'key set' : 'off (using public OSRM)' }}</strong>
        </p>
      </template>
      <p v-else-if="healthError" class="error small">{{ healthError }}</p>
      <p class="small muted" style="margin: 0.5rem 0 0">
        PocketBase:
        <strong>{{ pbReady ? 'configured' : 'not configured (guest localStorage)' }}</strong>
      </p>
      <p class="muted small" style="margin-top: 0.5rem">
        Put secrets in <code>.env</code> (server-only). See <code>.env.example</code>.
        Never put <code>XAI_API_KEY</code> in a <code>VITE_</code> variable.
      </p>
    </div>
  </section>
</template>
