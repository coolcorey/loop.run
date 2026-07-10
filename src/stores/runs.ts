import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type {
  CoachNudge,
  DistanceUnit,
  GeoPoint,
  PlannedRoute,
  RunLog,
  RunSplit,
  StartRunOptions,
} from '@/types'
import { loadJson, saveJson, uid } from '@/services/storage'
import { estimateCalories, fromMeters, haversineMeters } from '@/services/geo'
import {
  advanceAlong,
  detectLoopFinish,
  distanceToStart,
  pathTotalMeters,
  snapToPath,
  splitBoundaryMeters,
} from '@/services/routeMath'
import { useGuestStore } from './guest'

const ROUTES_KEY = 'loop.routes'
const RUNS_KEY = 'loop.runs'
const ACTIVE_RUN_KEY = 'loop.activeRun'
const ACTIVE_ROUTE_KEY = 'loop.activeRoute'

const MAX_SPEED_MPS = 12
const MAX_ACCURACY_M = 50
const MAX_SAMPLES = 2_000
const STALE_RUN_MS = 12 * 60 * 60 * 1000

function isStaleRun(run: RunLog | null): boolean {
  if (!run || run.finishedAt) return true
  const started = new Date(run.startedAt).getTime()
  if (!Number.isFinite(started)) return true
  return Date.now() - started > STALE_RUN_MS
}

function migrateRun(raw: RunLog | null): RunLog | null {
  if (!raw) return null
  return {
    ...raw,
    alongRouteMeters: raw.alongRouteMeters ?? 0,
    loopCompleted: raw.loopCompleted ?? false,
    offRoute: raw.offRoute ?? false,
    splits: raw.splits ?? [],
    targetSpeedMps: raw.targetSpeedMps ?? null,
    planId: raw.planId ?? null,
    planDay: raw.planDay ?? null,
    sessionTitle: raw.sessionTitle ?? null,
  }
}

function loadActiveRun(): RunLog | null {
  const run = migrateRun(loadJson<RunLog | null>(ACTIVE_RUN_KEY, null))
  if (!run || isStaleRun(run)) {
    if (run) saveJson(ACTIVE_RUN_KEY, null)
    return null
  }
  return run
}

export const useRunsStore = defineStore('runs', () => {
  const routes = ref<PlannedRoute[]>(loadJson(ROUTES_KEY, []))
  const history = ref<RunLog[]>(
    loadJson<RunLog[]>(RUNS_KEY, []).map((r) => migrateRun(r)!),
  )
  const activeRoute = ref<PlannedRoute | null>(
    loadJson<PlannedRoute | null>(ACTIVE_ROUTE_KEY, null),
  )
  const activeRun = ref<RunLog | null>(loadActiveRun())
  const latestNudge = ref<CoachNudge | null>(null)
  /** Live snap distance to path (not persisted) */
  const liveDistanceToPath = ref<number | null>(null)
  const justFinishedLoop = ref(false)

  function resolveRouteForRun(run: RunLog | null): PlannedRoute | null {
    if (!run || run.finishedAt) return null
    if (run.routeId == null) return null
    if (activeRoute.value?.id === run.routeId && activeRoute.value.path?.length) {
      return activeRoute.value
    }
    const fromList = routes.value.find((r) => r.id === run.routeId)
    if (fromList?.path?.length) return fromList
    if (activeRoute.value?.id === run.routeId) return activeRoute.value
    return null
  }

  function sanitizeActiveRun() {
    const run = activeRun.value
    if (!run || run.finishedAt) {
      if (run?.finishedAt) activeRun.value = null
      return
    }
    if (run.routeId == null) return
    const route = resolveRouteForRun(run)
    if (!route) {
      activeRun.value = null
      latestNudge.value = null
      return
    }
    if (activeRoute.value?.id !== route.id) {
      activeRoute.value = route
    }
  }

  sanitizeActiveRun()

  watch(routes, (v) => saveJson(ROUTES_KEY, v), { deep: true })
  watch(history, (v) => saveJson(RUNS_KEY, v), { deep: true })
  watch(activeRun, (v) => saveJson(ACTIVE_RUN_KEY, v), { deep: true })
  watch(
    activeRoute,
    (v) => {
      saveJson(ACTIVE_ROUTE_KEY, v)
      if (
        v &&
        activeRun.value &&
        !activeRun.value.finishedAt &&
        activeRun.value.routeId != null &&
        activeRun.value.routeId !== v.id
      ) {
        activeRun.value = null
        latestNudge.value = null
      }
    },
    { deep: true },
  )

  const hasActiveRun = computed(
    () => Boolean(activeRun.value && !activeRun.value.finishedAt),
  )

  const hasResumableRun = computed(() => {
    const run = activeRun.value
    if (!run || run.finishedAt) return false
    if (run.routeId == null) return true
    return Boolean(resolveRouteForRun(run))
  })

  const resumableSummary = computed(() => {
    const run = activeRun.value
    if (!hasResumableRun.value || !run) return null
    return {
      summary: run.routeSummary,
      distanceMeters: Math.max(run.alongRouteMeters, run.distanceMeters),
      durationSeconds: run.durationSeconds,
      routeId: run.routeId,
    }
  })

  const runMatchesRoute = computed(() => {
    const run = activeRun.value
    const route = activeRoute.value
    if (!run || run.finishedAt) return false
    if (run.routeId == null) return !route
    return route?.id === run.routeId
  })

  /** Prefer along-route distance when on a planned path */
  const trackedDistanceMeters = computed(() => {
    if (!runMatchesRoute.value || !activeRun.value) return 0
    const run = activeRun.value
    const route = activeRoute.value
    if (route?.path?.length && run.alongRouteMeters > 0) {
      return run.alongRouteMeters
    }
    return run.distanceMeters
  })

  const routeProgress = computed(() => {
    const route = activeRoute.value
    const run = activeRun.value
    if (!route || !run || !runMatchesRoute.value) return 0
    const total = route.distanceMeters || pathTotalMeters(route.path)
    if (total <= 0) return 0
    return Math.min(1, trackedDistanceMeters.value / total)
  })

  const remainingMeters = computed(() => {
    const route = activeRoute.value
    if (!route || !runMatchesRoute.value) return 0
    const total = route.distanceMeters || pathTotalMeters(route.path)
    return Math.max(0, total - trackedDistanceMeters.value)
  })

  function saveRoute(route: PlannedRoute) {
    routes.value = [route, ...routes.value.filter((r) => r.id !== route.id)].slice(
      0,
      30,
    )
    activeRoute.value = route
    if (
      activeRun.value &&
      !activeRun.value.finishedAt &&
      activeRun.value.routeId !== route.id
    ) {
      activeRun.value = null
      latestNudge.value = null
    }
  }

  function setActiveRoute(route: PlannedRoute | null) {
    activeRoute.value = route
    if (
      route &&
      activeRun.value &&
      !activeRun.value.finishedAt &&
      activeRun.value.routeId !== route.id
    ) {
      activeRun.value = null
      latestNudge.value = null
    }
  }

  function prepareResume(): boolean {
    sanitizeActiveRun()
    const run = activeRun.value
    if (!run || run.finishedAt) return false
    if (run.routeId == null) return true
    const route = resolveRouteForRun(run)
    if (!route) {
      activeRun.value = null
      return false
    }
    activeRoute.value = route
    return true
  }

  function startRun(route: PlannedRoute | null, options: StartRunOptions = {}) {
    justFinishedLoop.value = false
    liveDistanceToPath.value = null
    const log: RunLog = {
      id: uid('run'),
      routeId: route?.id ?? null,
      routeSummary:
        options.sessionTitle ||
        route?.summary ||
        'Free run',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      distanceMeters: 0,
      alongRouteMeters: 0,
      durationSeconds: 0,
      estimatedCalories: 0,
      avgSpeedMps: null,
      samples: [],
      nudges: [],
      completed: false,
      loopCompleted: false,
      offRoute: false,
      splits: [],
      targetSpeedMps: options.targetSpeedMps ?? null,
      planId: options.planId ?? null,
      planDay: options.planDay ?? null,
      sessionTitle: options.sessionTitle ?? null,
    }
    if (route) {
      routes.value = [route, ...routes.value.filter((r) => r.id !== route.id)].slice(
        0,
        30,
      )
      activeRoute.value = route
    }
    activeRun.value = log
    latestNudge.value = null
  }

  function maybeAddSplits(run: RunLog, unit: DistanceUnit) {
    const boundary = splitBoundaryMeters(unit)
    const progressDist = Math.max(run.alongRouteMeters, run.distanceMeters)
    const nextIndex = run.splits.length + 1
    const need = nextIndex * boundary
    if (progressDist < need) return

    const prevTime =
      nextIndex === 1
        ? 0
        : run.splits.reduce((s, sp) => s + sp.durationSeconds, 0)
    const splitSeconds = Math.max(1, run.durationSeconds - prevTime)
    const splitMeters = boundary
    const unitDist = fromMeters(splitMeters, unit)
    const pace = unitDist > 0 ? splitSeconds / unitDist : 0

    const split: RunSplit = {
      index: nextIndex,
      unit,
      splitMeters,
      cumulativeMeters: need,
      durationSeconds: splitSeconds,
      paceSecondsPerUnit: pace,
      at: new Date().toISOString(),
    }
    run.splits.push(split)
    // Chain if they jumped multiple splits (rare)
    if (progressDist >= (nextIndex + 1) * boundary) {
      maybeAddSplits(run, unit)
    }
  }

  function appendSample(point: GeoPoint) {
    const run = activeRun.value
    if (!run || run.finishedAt) return { accepted: false, reason: 'no-run' as const }

    if (point.accuracy != null && point.accuracy > MAX_ACCURACY_M) {
      return { accepted: false, reason: 'accuracy' as const }
    }

    const samples = run.samples
    if (samples.length > 0) {
      const prev = samples[samples.length - 1]
      const dist = haversineMeters(prev, point)
      const dtMs = Math.max(
        1,
        (point.timestamp ?? Date.now()) - (prev.timestamp ?? Date.now() - 1000),
      )
      const speed = dist / (dtMs / 1000)

      if (speed > MAX_SPEED_MPS || dist > MAX_SPEED_MPS * 15) {
        samples[samples.length - 1] = point
        return { accepted: false, reason: 'jump' as const }
      }

      if (dist < 1.5) {
        samples[samples.length - 1] = {
          ...point,
          speed: point.speed ?? prev.speed,
        }
        return { accepted: false, reason: 'noise' as const }
      }

      // Prefer device speed; fall back to ground speed for trail coloring
      if (point.speed == null || !Number.isFinite(point.speed)) {
        point = { ...point, speed: dist / (dtMs / 1000) }
      }

      run.distanceMeters += dist
    }

    samples.push(point)
    if (samples.length > MAX_SAMPLES) {
      run.samples = [samples[0], ...samples.slice(-MAX_SAMPLES + 1)]
    }

    const started = new Date(run.startedAt).getTime()
    const now = point.timestamp ?? Date.now()
    run.durationSeconds = Math.max(0, Math.round((now - started) / 1000))
    if (run.durationSeconds > 0) {
      run.avgSpeedMps = run.distanceMeters / run.durationSeconds
    }
    const guest = useGuestStore()
    run.estimatedCalories = estimateCalories(
      Math.max(run.alongRouteMeters, run.distanceMeters),
      guest.profile.weightKg,
    )

    // --- On-route tracking ---
    const route = activeRoute.value
    if (route?.path?.length && run.routeId === route.id) {
      const total = route.distanceMeters || pathTotalMeters(route.path)
      const snap = snapToPath(route.path, point)
      if (snap) {
        liveDistanceToPath.value = snap.distanceToPath
        const threshold = guest.profile.offRouteMeters
        run.offRoute = snap.distanceToPath > threshold

        if (!run.offRoute) {
          run.alongRouteMeters = advanceAlong(
            run.alongRouteMeters,
            snap.alongMeters,
            total,
          )
        }

        // Finish detection
        if (
          !run.loopCompleted &&
          detectLoopFinish({
            alongMeters: run.alongRouteMeters,
            totalMeters: total,
            distanceToStartMeters: distanceToStart(route.path, point),
          })
        ) {
          run.loopCompleted = true
          run.alongRouteMeters = Math.max(run.alongRouteMeters, total)
          justFinishedLoop.value = true
        }
      }
    } else {
      liveDistanceToPath.value = null
      run.offRoute = false
    }

    maybeAddSplits(run, guest.unit)

    return { accepted: true, reason: 'ok' as const }
  }

  function addNudge(nudge: CoachNudge) {
    const run = activeRun.value
    if (!run) return
    run.nudges.push(nudge)
    if (run.nudges.length > 100) run.nudges = run.nudges.slice(-100)
    latestNudge.value = nudge
  }

  function clearJustFinishedLoop() {
    justFinishedLoop.value = false
  }

  function finishRun(completed = true) {
    const run = activeRun.value
    if (!run) return
    run.finishedAt = new Date().toISOString()
    run.completed = completed || run.loopCompleted
    // Keep a denser trail snapshot for history speed-map (with speeds)
    run.trailSnapshot = downsampleTrail(run.samples, 180)
    const archived: RunLog = {
      ...run,
      samples:
        run.samples.length > 120
          ? downsampleTrail(run.samples, 120)
          : run.samples,
    }
    history.value = [archived, ...history.value].slice(0, 100)
    activeRun.value = null
    latestNudge.value = null
    liveDistanceToPath.value = null
    justFinishedLoop.value = false
  }

  function discardActiveRun() {
    activeRun.value = null
    latestNudge.value = null
    liveDistanceToPath.value = null
    justFinishedLoop.value = false
  }

  return {
    routes,
    history,
    activeRoute,
    activeRun,
    latestNudge,
    liveDistanceToPath,
    justFinishedLoop,
    hasActiveRun,
    hasResumableRun,
    resumableSummary,
    runMatchesRoute,
    trackedDistanceMeters,
    routeProgress,
    remainingMeters,
    resolveRouteForRun,
    sanitizeActiveRun,
    prepareResume,
    saveRoute,
    setActiveRoute,
    startRun,
    appendSample,
    addNudge,
    clearJustFinishedLoop,
    finishRun,
    discardActiveRun,
  }
})

/** Evenly sample trail points, preserving speed for gradient maps */
function downsampleTrail(points: GeoPoint[], max: number): GeoPoint[] {
  if (points.length <= max) return points.map((p) => ({ ...p }))
  const out: GeoPoint[] = []
  const step = (points.length - 1) / (max - 1)
  for (let i = 0; i < max; i++) {
    const p = points[Math.round(i * step)]
    out.push({ ...p })
  }
  return out
}
