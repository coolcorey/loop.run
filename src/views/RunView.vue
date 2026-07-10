<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import RouteMap from '@/components/RouteMap.vue'
import { ai } from '@/services/ai'
import {
  formatDistance,
  formatDuration,
  formatPace,
  fromMeters,
  haversineMeters,
} from '@/services/geo'
import { speedToPaceSeconds } from '@/services/session'
import {
  speak,
  stopSpeaking,
  unlockSpeech,
  warmVoices,
} from '@/services/voice'
import {
  enableRunWakeLock,
  isWakeLockActive,
  isWakeLockSupported,
  releaseScreenWakeLock,
} from '@/services/wakeLock'
import { useGuestStore } from '@/stores/guest'
import { usePlansStore } from '@/stores/plans'
import { useRunsStore } from '@/stores/runs'
import { resolveHeading } from '@/services/bearing'
import { SPEED_LEGEND, speedToColor } from '@/services/speedColor'
import type { CoachContext, GeoPoint } from '@/types'

const guest = useGuestStore()
const runs = useRunsStore()
const plans = usePlansStore()
const vueRoute = useRoute()

const watching = ref(false)
const tracking = ref(false)
const error = ref<string | null>(null)
const lastPoint = ref<GeoPoint | null>(null)
/** Smoothed travel direction for map heading-up */
const mapHeading = ref<number | null>(null)
/** Heading-up (course up) vs north-up */
const headingUp = ref(true)

const wakeSupported = isWakeLockSupported()
const wakeActive = ref(false)
const lastSplitCount = ref(0)
let watchId: number | null = null
let nudgeTimer: number | null = null
let tickTimer: number | null = null
const nowTick = ref(Date.now())

const lastSpokenTurnKey = ref<string | null>(null)
const lastSpokenCoach = ref<string | null>(null)
const lastOffRouteSpoken = ref(false)

const run = computed(() => runs.activeRun)
const route = computed(() => runs.activeRoute)

const trailSamples = computed(() => run.value?.samples ?? [])

const liveSpeedMps = computed(() => {
  const p = lastPoint.value
  if (p?.speed != null && Number.isFinite(p.speed) && p.speed >= 0) {
    return p.speed
  }
  const samples = trailSamples.value
  if (samples.length < 2) return null
  const a = samples[samples.length - 2]
  const b = samples[samples.length - 1]
  const dist = haversineMeters(a, b)
  const dt = ((b.timestamp ?? 0) - (a.timestamp ?? 0)) / 1000
  if (dt <= 0) return null
  return dist / dt
})

const liveSpeedLabel = computed(() => {
  const s = liveSpeedMps.value
  if (s == null) return null
  const unit = guest.unit
  if (unit === 'mi') {
    return `${(s * 2.23694).toFixed(1)} mph`
  }
  return `${(s * 3.6).toFixed(1)} km/h`
})

const elapsed = computed(() => {
  if (!run.value) return 0
  if (run.value.finishedAt) return run.value.durationSeconds
  const start = new Date(run.value.startedAt).getTime()
  return Math.max(0, Math.floor((nowTick.value - start) / 1000))
})

const paceSeconds = computed(() => {
  const d = runs.trackedDistanceMeters
  if (d < 20) return 0
  const unitDist = fromMeters(d, guest.unit)
  if (unitDist <= 0) return 0
  return elapsed.value / unitDist
})

const targetPaceDisplay = computed(() => {
  const sp = run.value?.targetSpeedMps
  if (!sp) return null
  return formatPace(speedToPaceSeconds(sp, guest.unit))
})

const progress = computed(() => runs.routeProgress)
const remaining = computed(() => runs.remainingMeters)

const staleRunBanner = computed(() => {
  const r = runs.activeRun
  if (!r || r.finishedAt) return null
  if (runs.runMatchesRoute) return null
  return r
})

const upcomingTurn = computed(() => {
  const r = route.value
  const me = lastPoint.value
  if (!r?.turns?.length || !me) return null
  const announce = guest.profile.turnAnnounceMeters
  let best: { key: string; instruction: string; meters: number } | null = null
  for (const t of r.turns) {
    const pt = r.path[t.pathIndex]
    if (!pt) continue
    const meters = haversineMeters(me, pt)
    if (meters <= (t.announceDistanceMeters || announce) * 1.5) {
      if (!best || meters < best.meters) {
        best = {
          key: t.id || `${t.pathIndex}:${t.instruction}`,
          instruction: t.instruction,
          meters,
        }
      }
    }
  }
  return best
})

function voiceOpts() {
  return { rate: guest.profile.voiceRate, interrupt: true }
}

function speakCoach(message: string) {
  if (!guest.profile.voiceEnabled || !guest.profile.voiceCoach) return
  if (!message || message === lastSpokenCoach.value) return
  lastSpokenCoach.value = message
  speak(message, voiceOpts())
}

function speakTurn(instruction: string, meters: number) {
  if (!guest.profile.voiceEnabled || !guest.profile.voiceTurns) return
  const dist =
    meters < 25 ? 'now' : `in ${Math.round(meters)} meters`
  speak(`${instruction}. ${dist}`, voiceOpts())
}

function coachPhase(p: number): CoachContext['phase'] {
  if (p < 0.1) return 'warmup'
  if (p > 0.9) return 'finish'
  if (p > 0.75) return 'push'
  return 'steady'
}

async function requestNudge() {
  if (!run.value || !tracking.value) return
  if (run.value.offRoute) {
    speakCoach('You are off the path. Head back to the route.')
    return
  }

  const ctx: CoachContext = {
    speedMps: lastPoint.value?.speed ?? run.value.avgSpeedMps,
    targetSpeedMps: run.value.targetSpeedMps,
    distanceRemainingMeters: remaining.value,
    distanceDoneMeters: runs.trackedDistanceMeters,
    elapsedSeconds: elapsed.value,
    progress: progress.value,
    phase: coachPhase(progress.value),
    offRoute: run.value.offRoute,
  }

  try {
    const nudge = await ai.coachNudge(ctx)
    runs.addNudge(nudge)
    speakCoach(nudge.message)
  } catch {
    // best-effort
  }
}

function onPosition(pos: GeolocationPosition) {
  const prev = lastPoint.value
  const point: GeoPoint = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    altitude: pos.coords.altitude ?? undefined,
    accuracy: pos.coords.accuracy,
    speed: pos.coords.speed ?? undefined,
    heading: pos.coords.heading ?? undefined,
    timestamp: pos.timestamp,
  }
  const h = resolveHeading(point, prev)
  if (h != null) {
    // Light smoothing so the map doesn't twitch
    if (mapHeading.value == null) {
      mapHeading.value = h
    } else {
      const prevH = mapHeading.value
      let delta = h - prevH
      if (delta > 180) delta -= 360
      if (delta < -180) delta += 360
      mapHeading.value = (prevH + delta * 0.35 + 360) % 360
    }
  }
  lastPoint.value = point
  runs.appendSample(point)
}

function startWatching() {
  if (!navigator.geolocation) {
    error.value = 'Geolocation not supported in this browser.'
    return
  }
  error.value = null
  watchId = navigator.geolocation.watchPosition(
    onPosition,
    (err) => {
      error.value = err.message || 'Location error'
    },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
  )
  watching.value = true
}

function stopWatching() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
  }
  watching.value = false
}

async function applyWakeLock() {
  const ok = await enableRunWakeLock(guest.profile.keepScreenOnDuringRun)
  wakeActive.value = ok && isWakeLockActive()
}

async function clearWakeLock() {
  await releaseScreenWakeLock()
  wakeActive.value = false
}

function stopTrackingTimers() {
  stopWatching()
  if (nudgeTimer) {
    window.clearInterval(nudgeTimer)
    nudgeTimer = null
  }
  tracking.value = false
}

async function beginTracking(opts: { resumed?: boolean } = {}) {
  startWatching()
  tracking.value = true
  lastSplitCount.value = run.value?.splits.length ?? 0
  await applyWakeLock()
  if (nudgeTimer) window.clearInterval(nudgeTimer)
  nudgeTimer = window.setInterval(() => void requestNudge(), 45_000)
  if (!opts.resumed) {
    void requestNudge()
  }
}

async function start(opts: { forceNew?: boolean } = {}) {
  unlockSpeech()
  warmVoices()

  const existing = runs.activeRun
  const canResume =
    !opts.forceNew &&
    existing &&
    !existing.finishedAt &&
    runs.prepareResume()

  if (!canResume) {
    runs.startRun(runs.activeRoute, {
      targetSpeedMps: existing?.targetSpeedMps ?? null,
      planId: existing?.planId ?? null,
      planDay: existing?.planDay ?? null,
      sessionTitle: existing?.sessionTitle ?? null,
    })
  }

  lastSpokenTurnKey.value = null
  lastSpokenCoach.value = null
  lastOffRouteSpoken.value = false
  await beginTracking({ resumed: Boolean(canResume) })
  if (guest.profile.voiceEnabled) {
    const sessionBit = run.value?.sessionTitle
      ? `${run.value.sessionTitle}. `
      : ''
    speak(
      canResume
        ? 'Resuming run.'
        : `${sessionBit}Loop started. Let’s go.`,
      voiceOpts(),
    )
  }
}

async function finish(auto = false) {
  stopTrackingTimers()
  await clearWakeLock()

  const finished = runs.activeRun
  if (
    finished?.planId != null &&
    finished.planDay != null &&
    (finished.loopCompleted || finished.completed || auto)
  ) {
    plans.markSessionComplete(finished.planId, finished.planDay)
  }

  if (guest.profile.voiceEnabled) {
    speak(
      auto || finished?.loopCompleted
        ? 'Loop complete. Great work.'
        : 'Run saved. Nice work.',
      voiceOpts(),
    )
  }
  runs.finishRun(true)
}

async function discard() {
  stopTrackingTimers()
  stopSpeaking()
  await clearWakeLock()
  runs.discardActiveRun()
}

watch(upcomingTurn, (turn) => {
  if (!turn || !tracking.value) {
    if (!turn) lastSpokenTurnKey.value = null
    return
  }
  if (turn.key === lastSpokenTurnKey.value) return
  lastSpokenTurnKey.value = turn.key
  speakTurn(turn.instruction, turn.meters)
})

watch(
  () => run.value?.offRoute,
  (off) => {
    if (!tracking.value || !run.value) return
    if (off && !lastOffRouteSpoken.value) {
      lastOffRouteSpoken.value = true
      speakCoach('Off route. Turn back toward the path.')
    } else if (!off && lastOffRouteSpoken.value) {
      lastOffRouteSpoken.value = false
      speakCoach('Back on route. Nice.')
    }
  },
)

watch(
  () => run.value?.splits.length ?? 0,
  (n) => {
    if (!tracking.value || n <= lastSplitCount.value) return
    const split = run.value?.splits[n - 1]
    lastSplitCount.value = n
    if (split && guest.profile.voiceEnabled) {
      speak(
        `Split ${split.index}. Pace ${formatPace(split.paceSecondsPerUnit)} per ${guest.unit}.`,
        voiceOpts(),
      )
    }
  },
)

watch(
  () => runs.justFinishedLoop,
  (done) => {
    if (!done || !tracking.value) return
    runs.clearJustFinishedLoop()
    void finish(true)
  },
)

onMounted(() => {
  warmVoices()
  tickTimer = window.setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)

  runs.sanitizeActiveRun()

  const wantResume = vueRoute.query.resume === '1'
  if (wantResume) {
    if (runs.prepareResume()) {
      void start({ forceNew: false })
    } else {
      error.value =
        'Nothing to resume — that run’s route is gone. Plan a loop and start fresh.'
    }
  }
})

onBeforeUnmount(() => {
  stopTrackingTimers()
  stopSpeaking()
  void clearWakeLock()
  if (tickTimer) window.clearInterval(tickTimer)
})
</script>

<template>
  <section>
    <h1>Run</h1>
    <p class="lede">
      On-route progress, splits, and coach.
      <RouterLink to="/settings">Settings</RouterLink>
    </p>

    <div v-if="run?.sessionTitle" class="card">
      <div class="card-title">Session</div>
      <strong>{{ run.sessionTitle }}</strong>
      <p v-if="targetPaceDisplay" class="muted small" style="margin: 0.35rem 0 0">
        Target pace {{ targetPaceDisplay }} / {{ guest.unit }}
      </p>
    </div>

    <div v-if="route" class="card">
      <div class="card-title">Route</div>
      <strong>{{ route.summary }}</strong>
      <p class="muted small" style="margin: 0.35rem 0 0.65rem">
        {{ formatDistance(route.distanceMeters, guest.unit) }}
        · ~{{ route.estimatedCalories }} kcal
      </p>
      <RouteMap
        :path="route.path"
        :user="lastPoint"
        :trail="trailSamples"
        :heading="mapHeading"
        :heading-up="headingUp"
        mode="follow"
        height="280px"
      />
      <div class="speed-legend" aria-label="Speed color legend">
        <span
          v-for="s in SPEED_LEGEND"
          :key="s.label"
          class="speed-legend-stop"
        >
          <i :style="{ background: s.color }" />
          {{ s.label }}
        </span>
      </div>
      <div class="row" style="margin-top: 0.55rem; justify-content: space-between">
        <span class="muted small">Map orientation</span>
        <div class="seg">
          <button
            type="button"
            :class="{ active: headingUp }"
            @click="headingUp = true"
          >
            Heading up
          </button>
          <button
            type="button"
            :class="{ active: !headingUp }"
            @click="headingUp = false"
          >
            North up
          </button>
        </div>
      </div>
      <p class="muted small" style="margin: 0.35rem 0 0">
        <template v-if="mapHeading != null">
          Bearing {{ Math.round(mapHeading) }}°
        </template>
        <template v-if="liveSpeedLabel">
          <template v-if="mapHeading != null"> · </template>
          <span :style="{ color: speedToColor(liveSpeedMps) }">
            {{ liveSpeedLabel }}
          </span>
        </template>
        <template v-if="!lastPoint"> Waiting for GPS… </template>
      </p>
    </div>
    <div v-else class="card">
      <p class="muted small" style="margin: 0">
        No planned route.
        <RouterLink to="/plan">Plan a loop</RouterLink>
        or start a free run.
      </p>
    </div>

    <div
      v-if="tracking && run && runs.runMatchesRoute"
      class="card"
      :class="{ 'turn-cue': run.offRoute }"
    >
      <div class="card-title">Route status</div>
      <strong :class="run.offRoute ? 'error' : 'success'">
        {{ run.offRoute ? 'Off route' : 'On route' }}
      </strong>
      <p v-if="runs.liveDistanceToPath != null" class="muted small" style="margin: 0.25rem 0 0">
        {{ Math.round(runs.liveDistanceToPath) }} m from path
        · threshold {{ guest.profile.offRouteMeters }} m
      </p>
    </div>

    <div v-if="upcomingTurn" class="card turn-cue">
      <div class="card-title">Upcoming</div>
      <strong>{{ upcomingTurn.instruction }}</strong>
      <p class="muted small" style="margin: 0.25rem 0 0">
        in {{ Math.round(upcomingTurn.meters) }} m
      </p>
    </div>

    <div class="card">
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-label">Time</div>
          <div class="stat-value">{{ formatDuration(elapsed) }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Along route</div>
          <div class="stat-value">
            {{ formatDistance(runs.trackedDistanceMeters, guest.unit) }}
          </div>
        </div>
        <div class="stat">
          <div class="stat-label">Pace / {{ guest.unit }}</div>
          <div class="stat-value">{{ formatPace(paceSeconds) }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">kcal</div>
          <div class="stat-value">
            {{ runs.runMatchesRoute ? (run?.estimatedCalories ?? 0) : 0 }}
          </div>
        </div>
      </div>

      <div v-if="route" class="muted small" style="margin-top: 0.75rem">
        Progress {{ Math.round(progress * 100) }}%
        · remaining {{ formatDistance(remaining, guest.unit) }}
        · route {{ formatDistance(route.distanceMeters, guest.unit) }}
      </div>
      <div v-if="targetPaceDisplay" class="muted small">
        Target {{ targetPaceDisplay }} / {{ guest.unit }}
        <template v-if="paceSeconds > 0">
          · current {{ formatPace(paceSeconds) }}
        </template>
      </div>
    </div>

    <div v-if="run?.splits?.length" class="card">
      <div class="card-title">Splits</div>
      <div
        v-for="s in run.splits"
        :key="s.index"
        class="list-item"
        style="padding: 0.4rem 0"
      >
        <span class="small">
          <strong>{{ s.index }}</strong>
          {{ guest.unit === 'mi' ? 'mi' : 'km' }}
        </span>
        <span class="small muted">
          {{ formatDuration(s.durationSeconds) }}
          · {{ formatPace(s.paceSecondsPerUnit) }}/{{ guest.unit }}
        </span>
      </div>
    </div>

    <div
      v-if="runs.latestNudge"
      class="nudge"
      :class="`tone-${runs.latestNudge.tone}`"
      style="margin-bottom: 0.85rem"
    >
      {{ runs.latestNudge.message }}
    </div>
    <div v-else class="card">
      <p class="muted small" style="margin: 0">Coach is quiet until you start.</p>
    </div>

    <div v-if="staleRunBanner" class="card">
      <p class="small" style="margin: 0 0 0.5rem">
        An unfinished run is saved
        ({{ formatDistance(staleRunBanner.distanceMeters, guest.unit) }})
        but it doesn’t match this route. Start fresh or discard it.
      </p>
      <div class="row">
        <button class="btn btn-primary" type="button" style="flex: 1" @click="start({ forceNew: true })">
          Start fresh
        </button>
        <button class="btn btn-danger" type="button" style="flex: 1" @click="discard">
          Discard old
        </button>
      </div>
    </div>

    <div
      v-else-if="run && runs.runMatchesRoute && !tracking"
      class="card"
    >
      <p class="small" style="margin: 0 0 0.5rem">
        In progress:
        <strong>{{ run.routeSummary }}</strong>
        · {{ formatDistance(runs.trackedDistanceMeters, guest.unit) }}
        · {{ formatDuration(elapsed) }}
      </p>
      <button class="btn btn-primary btn-block" type="button" @click="start({ forceNew: false })">
        Resume tracking
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="watching && tracking" class="success small">GPS tracking on</p>
    <p v-if="run && runs.runMatchesRoute && tracking && guest.profile.keepScreenOnDuringRun" class="small" :class="wakeActive ? 'success' : 'muted'">
      <template v-if="!wakeSupported">Screen wake lock not supported here.</template>
      <template v-else-if="wakeActive">Screen stays on for this run</template>
      <template v-else>Trying to keep screen on… (or denied)</template>
    </p>
    <p v-if="lastPoint" class="muted small">
      Last fix ±{{ Math.round(lastPoint.accuracy ?? 0) }}m
      <template v-if="lastPoint.heading != null">
        · bearing {{ Math.round(lastPoint.heading) }}°
      </template>
    </p>

    <div class="stack">
      <button
        v-if="!run || !runs.runMatchesRoute"
        class="btn btn-primary btn-block"
        type="button"
        @click="start({ forceNew: true })"
      >
        Start run
      </button>
      <template v-else-if="tracking">
        <button class="btn btn-ghost btn-block" type="button" @click="requestNudge">
          Nudge me
        </button>
        <button class="btn btn-ghost btn-block" type="button" @click="start({ forceNew: true })">
          Restart from 0
        </button>
        <button class="btn btn-primary btn-block" type="button" @click="finish(false)">
          Finish &amp; save
        </button>
        <button class="btn btn-danger btn-block" type="button" @click="discard">
          Discard
        </button>
      </template>
      <template v-else>
        <button class="btn btn-ghost btn-block" type="button" @click="start({ forceNew: true })">
          Restart from 0
        </button>
        <button class="btn btn-danger btn-block" type="button" @click="discard">
          Discard
        </button>
      </template>
    </div>
  </section>
</template>
