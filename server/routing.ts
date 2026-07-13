import {
  estimateCalories,
  haversineMeters,
  loopWaypoints,
  outAndBackScore,
  pathLengthMeters,
  type Point,
} from './geo.js'
import { env } from './env.js'

export interface RouteTurn {
  id: string
  pathIndex: number
  instruction: string
  announceDistanceMeters: number
}

export interface RoutedLoop {
  path: Point[]
  distanceMeters: number
  estimatedCalories: number
  turns: RouteTurn[]
  provider: 'osrm' | 'ors' | 'mock'
  durationSeconds?: number
  /** 0 good circuit … higher = more out-and-back */
  outAndBack?: number
  /** How the geometry was generated */
  strategy?: 'round_trip' | 'ring_vias' | 'mock'
}

interface OsrmStep {
  maneuver?: { type?: string; modifier?: string; location?: [number, number] }
  /** Road / street name (OSRM) — not a full sentence */
  name?: string
  distance?: number
  /**
   * Ready-to-speak cue when the provider already gave one (ORS).
   * Prefer this over rebuilding from type/modifier/name.
   */
  instruction?: string
}

interface OsrmRoute {
  distance: number
  duration: number
  geometry?: { coordinates: [number, number][] }
  legs?: { steps?: OsrmStep[] }[]
}

type RoutedPath = {
  path: Point[]
  distance: number
  duration: number
  steps: OsrmStep[]
  provider: RoutedLoop['provider']
  strategy: NonNullable<RoutedLoop['strategy']>
}

/** Reject as “acceptable circuit” above this out-and-back score */
const OAB_ACCEPT = 0.22
/** Never early-exit / prefer unless under this */
const OAB_GREAT = 0.14
/** Absolute last-resort ceiling — still prefer lower if possible */
const OAB_HARD_CEILING = 0.38

function coordsParam(points: Point[]): string {
  return points.map((p) => `${p.lng},${p.lat}`).join(';')
}

function debugRouting(...args: unknown[]) {
  if (env('DEBUG_ROUTING') === '1') console.warn('[routing]', ...args)
}

async function routeOsrm(points: Point[]): Promise<{
  path: Point[]
  distance: number
  duration: number
  steps: OsrmStep[]
} | null> {
  if (points.length < 2) return null
  const base =
    env('OSRM_URL', 'https://router.project-osrm.org') ||
    'https://router.project-osrm.org'
  const url =
    `${base.replace(/\/$/, '')}/route/v1/foot/${coordsParam(points)}` +
    `?overview=full&geometries=geojson&steps=true&continue_straight=false`

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) return null
  const data = (await res.json()) as {
    code?: string
    routes?: OsrmRoute[]
  }
  if (data.code !== 'Ok' || !data.routes?.[0]) return null
  const route = data.routes[0]
  const coords = route.geometry?.coordinates ?? []
  const path = coords.map(([lng, lat]) => ({ lat, lng }))
  const steps = (route.legs ?? []).flatMap((l) => l.steps ?? [])
  return {
    path,
    distance: route.distance,
    duration: route.duration,
    steps,
  }
}

type OrsGeoJson = {
  features?: {
    geometry?: { coordinates: [number, number][] }
    properties?: {
      summary?: { distance?: number; duration?: number }
      segments?: {
        steps?: {
          instruction?: string
          distance?: number
          type?: number
          name?: string
          way_points?: [number, number]
        }[]
      }[]
    }
  }[]
}

function parseOrsGeoJson(data: OrsGeoJson): {
  path: Point[]
  distance: number
  duration: number
  steps: OsrmStep[]
} | null {
  const feature = data.features?.[0]
  if (!feature?.geometry?.coordinates?.length) return null
  const path = feature.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }))
  const distance =
    feature.properties?.summary?.distance ?? pathLengthMeters(path)
  const duration = feature.properties?.summary?.duration ?? 0
  const steps: OsrmStep[] = []
  for (const seg of feature.properties?.segments ?? []) {
    for (const s of seg.steps ?? []) {
      const wp = s.way_points?.[0]
      const loc =
        typeof wp === 'number' && path[wp]
          ? ([path[wp]!.lng, path[wp]!.lat] as [number, number])
          : undefined
      const { type, modifier } = orsStepKind(s)
      steps.push({
        instruction: cleanTurnPhrase(s.instruction || ''),
        distance: s.distance,
        maneuver: {
          type,
          modifier,
          location: loc,
        },
      })
    }
  }
  return { path, distance, duration, steps }
}

async function orsPost(
  body: Record<string, unknown>,
): Promise<{
  path: Point[]
  distance: number
  duration: number
  steps: OsrmStep[]
} | null> {
  const key = env('ORS_API_KEY')
  if (!key) return null

  const url =
    'https://api.openrouteservice.org/v2/directions/foot-walking/geojson'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: key,
      'Content-Type': 'application/json',
      Accept: 'application/geo+json, application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    debugRouting('ors', res.status, await res.text().catch(() => ''))
    return null
  }
  return parseOrsGeoJson((await res.json()) as OrsGeoJson)
}

/** Multi-via shortest-path through ring points (fallback). */
async function routeOrsVias(points: Point[]): Promise<{
  path: Point[]
  distance: number
  duration: number
  steps: OsrmStep[]
} | null> {
  if (points.length < 2) return null
  return orsPost({
    coordinates: points.map((p) => [p.lng, p.lat]),
    instructions: true,
    elevation: false,
    preference: 'recommended',
    options: {
      avoid_features: ['ferries', 'fords'],
    },
  })
}

/**
 * ORS round_trip — single start, target length, seed for direction.
 * Designed for circular outings rather than “shortest path through pins.”
 * @see https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options
 */
async function routeOrsRoundTrip(
  origin: Point,
  lengthMeters: number,
  opts: { points?: number; seed?: number },
): Promise<{
  path: Point[]
  distance: number
  duration: number
  steps: OsrmStep[]
} | null> {
  const length = Math.round(
    Math.min(Math.max(lengthMeters, 400), 100_000),
  )
  const points = Math.min(12, Math.max(3, opts.points ?? 5))
  const seed = Math.abs(Math.floor(opts.seed ?? 1)) % 10_000

  return orsPost({
    coordinates: [[origin.lng, origin.lat]],
    instructions: true,
    elevation: false,
    preference: 'recommended',
    options: {
      avoid_features: ['ferries', 'fords'],
      round_trip: {
        length,
        points,
        seed,
      },
    },
  })
}

/** Map ORS numeric step type → OSRM-ish type/modifier for fallback phrasing */
function orsStepKind(s: {
  type?: number
  instruction?: string
}): { type: string; modifier?: string } {
  switch (s.type) {
    case 0:
      return { type: 'turn', modifier: 'left' }
    case 1:
      return { type: 'turn', modifier: 'right' }
    case 2:
      return { type: 'turn', modifier: 'sharp left' }
    case 3:
      return { type: 'turn', modifier: 'sharp right' }
    case 4:
      return { type: 'turn', modifier: 'slight left' }
    case 5:
      return { type: 'turn', modifier: 'slight right' }
    case 6:
      return { type: 'continue', modifier: 'straight' }
    case 7:
      return { type: 'roundabout', modifier: undefined }
    case 8:
      return { type: 'exit roundabout', modifier: undefined }
    case 9:
      return { type: 'uturn', modifier: undefined }
    case 10:
      return { type: 'arrive', modifier: undefined }
    case 11:
      return { type: 'depart', modifier: undefined }
    case 12:
      return { type: 'fork', modifier: 'left' }
    case 13:
      return { type: 'fork', modifier: 'right' }
    default:
      return { type: 'turn', modifier: undefined }
  }
}

/** Normalize provider text for short outdoor TTS. */
function cleanTurnPhrase(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim()
  if (!s || s === '-' || s === '–') return ''
  s = s.replace(
    /^Head\s+(north|south|east|west|northeast|northwest|southeast|southwest)\b[^.!]*/i,
    '',
  )
  s = s.replace(/\s+/g, ' ').trim()
  if (s.length > 72) {
    const cut = s.slice(0, 72)
    const sp = cut.lastIndexOf(' ')
    s = (sp > 40 ? cut.slice(0, sp) : cut).trim()
  }
  return s
}

function mockGeometricLoop(origin: Point, distanceMeters: number): RoutedLoop {
  const points = 48
  const radiusM = distanceMeters / (2 * Math.PI)
  const path: Point[] = []
  const metersPerDegLat = 111_320
  const metersPerDegLng = 111_320 * Math.cos((origin.lat * Math.PI) / 180)
  for (let i = 0; i <= points; i++) {
    const theta = (i / points) * 2 * Math.PI
    const r = radiusM * (1 + 0.08 * Math.sin(2 * theta))
    path.push({
      lat: origin.lat + (r * Math.cos(theta)) / metersPerDegLat,
      lng: origin.lng + (r * Math.sin(theta)) / metersPerDegLng,
    })
  }
  return {
    path,
    distanceMeters: pathLengthMeters(path),
    estimatedCalories: 0,
    turns: [],
    provider: 'mock',
    outAndBack: 0,
    strategy: 'mock',
  }
}

function stepsToTurns(
  path: Point[],
  steps: OsrmStep[],
  announceMeters: number,
): RouteTurn[] {
  const turns: RouteTurn[] = []
  let lastPhrase = ''

  for (const step of steps) {
    const type = (step.maneuver?.type ?? '').toLowerCase()
    if (
      type === 'depart' ||
      type === 'arrive' ||
      type === 'new name' ||
      type === 'notification'
    ) {
      continue
    }

    if (
      (type === 'continue' || type === 'new name') &&
      (step.distance ?? 0) < 80
    ) {
      continue
    }
    if ((step.distance ?? 0) < 12 && type === 'continue') continue

    const loc = step.maneuver?.location
    if (!loc || !Number.isFinite(loc[0]) || !Number.isFinite(loc[1])) continue

    const point = { lng: loc[0], lat: loc[1] }
    let bestIdx = 0
    let best = Infinity
    for (let i = 0; i < path.length; i++) {
      const d = haversineMeters(path[i]!, point)
      if (d < best) {
        best = d
        bestIdx = i
      }
    }

    const phrase = formatTurnInstruction(step)
    if (!phrase) continue
    if (phrase.toLowerCase() === lastPhrase.toLowerCase()) continue
    lastPhrase = phrase

    turns.push({
      id: `turn_${turns.length}`,
      pathIndex: bestIdx,
      instruction: phrase,
      announceDistanceMeters: announceMeters,
    })
  }

  if (turns.length > 24) {
    const step = Math.ceil(turns.length / 24)
    return turns.filter((_, i) => i % step === 0)
  }
  return turns
}

function formatTurnInstruction(step: OsrmStep): string {
  if (step.instruction) {
    return step.instruction
  }

  const type = (step.maneuver?.type ?? '').toLowerCase()
  const modifier = (step.maneuver?.modifier ?? '').toLowerCase().trim()
  const roadRaw = (step.name ?? '').trim()
  const road =
    roadRaw &&
    roadRaw !== '-' &&
    roadRaw.length < 48 &&
    !/^(turn|keep|continue|head|take|enter|exit)\b/i.test(roadRaw)
      ? roadRaw
      : ''

  let core = ''
  if (type === 'turn' || type === 'end of road' || type === 'fork') {
    if (modifier.includes('sharp') && modifier.includes('left')) core = 'Sharp left'
    else if (modifier.includes('sharp') && modifier.includes('right'))
      core = 'Sharp right'
    else if (modifier.includes('slight') && modifier.includes('left'))
      core = 'Slight left'
    else if (modifier.includes('slight') && modifier.includes('right'))
      core = 'Slight right'
    else if (modifier.includes('left')) core = 'Turn left'
    else if (modifier.includes('right')) core = 'Turn right'
    else if (modifier.includes('uturn') || modifier.includes('u-turn'))
      core = 'Make a U-turn'
    else core = type === 'fork' ? 'At the fork' : 'Turn'
  } else if (type === 'uturn' || type === 'u-turn') {
    core = 'Make a U-turn'
  } else if (type.includes('roundabout')) {
    core = type.includes('exit') ? 'Exit the roundabout' : 'Enter the roundabout'
  } else if (type === 'merge') {
    core = 'Merge'
  } else if (type === 'continue') {
    core = 'Continue'
  } else if (modifier) {
    core = capitalize(`${type} ${modifier}`.trim())
  } else if (type) {
    core = capitalize(type)
  } else {
    core = 'Continue'
  }

  if (road && !core.toLowerCase().includes(road.toLowerCase())) {
    return `${core} onto ${road}`
  }
  return core
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function toLoop(
  routed: RoutedPath,
  weightKg: number,
  turnAnnounceMeters: number,
): RoutedLoop {
  const oab = outAndBackScore(routed.path)
  return {
    path: routed.path,
    distanceMeters: routed.distance,
    estimatedCalories: estimateCalories(routed.distance, weightKg),
    turns: stepsToTurns(routed.path, routed.steps, turnAnnounceMeters),
    provider: routed.provider,
    durationSeconds: routed.duration,
    outAndBack: oab,
    strategy: routed.strategy,
  }
}

/** Score: heavily punish corridors; distance is secondary. */
function loopScore(loop: RoutedLoop, target: number): number {
  const ratio = loop.distanceMeters / target
  const distPenalty = Math.abs(1 - ratio)
  const oab = loop.outAndBack ?? 1
  // Extra penalty past accept threshold so hard rejects lose to clean circuits
  const hard = oab > OAB_ACCEPT ? (oab - OAB_ACCEPT) * 4 : 0
  return distPenalty * 0.7 + oab * 3.0 + hard
}

function distanceOk(loop: RoutedLoop, target: number): boolean {
  const ratio = loop.distanceMeters / target
  return ratio >= 0.78 && ratio <= 1.28
}

function isAcceptableCircuit(loop: RoutedLoop, target: number): boolean {
  const oab = loop.outAndBack ?? 1
  return distanceOk(loop, target) && oab < OAB_ACCEPT
}

/**
 * Plan a true road loop.
 * 1) ORS round_trip (circuit-oriented) with many seeds
 * 2) Ring via fallback
 * Hard-prefer low out-and-back; reject corridors when any better option exists.
 */
export async function planRoadLoop(input: {
  origin: Point
  distanceMeters: number
  weightKg: number
  turnAnnounceMeters: number
  startBearing?: number
}): Promise<RoutedLoop> {
  const target = Math.min(Math.max(input.distanceMeters, 400), 42_195)
  const baseBearing = input.startBearing ?? 20
  const hasOrs = Boolean(env('ORS_API_KEY'))

  let bestAcceptable: RoutedLoop | null = null
  let bestAcceptableScore = Infinity
  let bestAny: RoutedLoop | null = null
  let bestAnyScore = Infinity
  let lowestOab: RoutedLoop | null = null

  const consider = (loop: RoutedLoop) => {
    if (loop.path.length < 8) return
    const score = loopScore(loop, target)
    const oab = loop.outAndBack ?? 1

    if (score < bestAnyScore) {
      bestAnyScore = score
      bestAny = loop
    }
    if (!lowestOab || oab < (lowestOab.outAndBack ?? 1)) {
      lowestOab = loop
    }
    if (isAcceptableCircuit(loop, target) && score < bestAcceptableScore) {
      bestAcceptableScore = score
      bestAcceptable = loop
    }
  }

  // ── Phase 1: ORS round_trip ──────────────────────────────────────────
  if (hasOrs) {
    let lengthAsk = target
    const pointChoices = target > 6000 ? [6, 5, 7, 4] : target > 2500 ? [5, 4, 6] : [4, 5, 3]
    const seeds = 8

    for (let i = 0; i < seeds; i++) {
      const seed =
        (Math.floor(baseBearing) * 17 + i * 97 + Math.floor(target / 50)) % 9000
      const points = pointChoices[i % pointChoices.length]!
      const raw = await routeOrsRoundTrip(input.origin, lengthAsk, {
        points,
        seed: seed + i,
      }).catch(() => null)

      if (!raw || raw.path.length < 8) continue

      const loop = toLoop(
        { ...raw, provider: 'ors', strategy: 'round_trip' },
        input.weightKg,
        input.turnAnnounceMeters,
      )
      debugRouting(
        'round_trip',
        `seed=${seed}`,
        `pts=${points}`,
        `dist=${Math.round(loop.distanceMeters)}`,
        `oab=${(loop.outAndBack ?? 0).toFixed(3)}`,
      )
      consider(loop)

      if (
        isAcceptableCircuit(loop, target) &&
        (loop.outAndBack ?? 1) < OAB_GREAT &&
        Math.abs(loop.distanceMeters / target - 1) < 0.12
      ) {
        return loop
      }

      // Nudge requested length toward target
      const ratio = loop.distanceMeters / target
      if (ratio > 0.2) {
        lengthAsk = Math.round(
          Math.min(Math.max(lengthAsk * (1 / ratio) ** 0.9, target * 0.55), target * 1.55),
        )
      }
    }
  }

  // If we already have a clean circuit, skip expensive ring fallback
  if (bestAcceptable && (bestAcceptable.outAndBack ?? 1) < OAB_ACCEPT) {
    return bestAcceptable
  }

  // ── Phase 2: ring vias (ORS then OSRM) ───────────────────────────────
  let radiusScale = 0.8
  const ringAttempts = hasOrs ? 8 : 10

  for (let attempt = 0; attempt < ringAttempts; attempt++) {
    const bearing = (baseBearing + attempt * 31 + (attempt % 4) * 13) % 360
    const wpCount =
      target > 5000
        ? 9 + (attempt % 3)
        : target > 2500
          ? 7 + (attempt % 3)
          : 6 + (attempt % 3)

    const wps = loopWaypoints(
      input.origin,
      target,
      wpCount,
      radiusScale,
      bearing,
    )

    let routed: RoutedPath | null = null
    const ors = await routeOrsVias(wps).catch(() => null)
    if (ors) {
      routed = { ...ors, provider: 'ors', strategy: 'ring_vias' }
    } else {
      const osrm = await routeOsrm(wps).catch(() => null)
      if (osrm) routed = { ...osrm, provider: 'osrm', strategy: 'ring_vias' }
    }

    if (!routed || routed.path.length < 8) {
      radiusScale = Math.min(Math.max(radiusScale * 0.95, 0.35), 1.3)
      continue
    }

    const loop = toLoop(routed, input.weightKg, input.turnAnnounceMeters)
    debugRouting(
      'ring_vias',
      `attempt=${attempt}`,
      `dist=${Math.round(loop.distanceMeters)}`,
      `oab=${(loop.outAndBack ?? 0).toFixed(3)}`,
    )
    consider(loop)

    if (
      isAcceptableCircuit(loop, target) &&
      (loop.outAndBack ?? 1) < OAB_GREAT
    ) {
      return loop
    }

    radiusScale *= (target / Math.max(loop.distanceMeters, 1)) ** 0.85
    if ((loop.outAndBack ?? 0) > OAB_ACCEPT) radiusScale *= 1.1
    radiusScale = Math.min(Math.max(radiusScale, 0.35), 1.35)
  }

  // ── Phase 3: extra round_trip seeds if still no circuit ──────────────
  if (hasOrs && !bestAcceptable) {
    for (let i = 0; i < 6; i++) {
      const seed = (Math.floor(baseBearing) + 500 + i * 211) % 9000
      const raw = await routeOrsRoundTrip(input.origin, target * (0.9 + i * 0.05), {
        points: 5 + (i % 3),
        seed,
      }).catch(() => null)
      if (!raw) continue
      const loop = toLoop(
        { ...raw, provider: 'ors', strategy: 'round_trip' },
        input.weightKg,
        input.turnAnnounceMeters,
      )
      consider(loop)
      if (isAcceptableCircuit(loop, target)) return loop
    }
  }

  if (bestAcceptable) return bestAcceptable

  // No clean circuit: prefer lowest out-and-back under ceiling, else best score
  if (lowestOab && (lowestOab.outAndBack ?? 1) <= OAB_HARD_CEILING) {
    return lowestOab
  }
  if (bestAny && (bestAny.outAndBack ?? 1) <= OAB_HARD_CEILING) {
    return bestAny
  }
  // Still better a real road path than pure geometry when possible
  if (lowestOab) return lowestOab
  if (bestAny) return bestAny

  const mock = mockGeometricLoop(input.origin, target)
  mock.estimatedCalories = estimateCalories(mock.distanceMeters, input.weightKg)
  mock.turns = [
    {
      id: 'turn_0',
      pathIndex: Math.floor(mock.path.length * 0.25),
      instruction: 'Follow the loop (offline geometry)',
      announceDistanceMeters: input.turnAnnounceMeters,
    },
  ]
  return mock
}
