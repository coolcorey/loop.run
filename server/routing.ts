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
}

interface OsrmStep {
  maneuver?: { type?: string; modifier?: string; location?: [number, number] }
  name?: string
  distance?: number
}

interface OsrmRoute {
  distance: number
  duration: number
  geometry?: { coordinates: [number, number][] }
  legs?: { steps?: OsrmStep[] }[]
}

function coordsParam(points: Point[]): string {
  return points.map((p) => `${p.lng},${p.lat}`).join(';')
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
  // continue_straight=false lets the foot router leave a corridor for ring vias
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

async function routeOrs(points: Point[]): Promise<{
  path: Point[]
  distance: number
  duration: number
  steps: OsrmStep[]
} | null> {
  const key = env('ORS_API_KEY')
  if (!key) return null

  // GeoJSON endpoint wants Accept: application/geo+json (application/json → 406)
  const url =
    'https://api.openrouteservice.org/v2/directions/foot-walking/geojson'
  const body = {
    coordinates: points.map((p) => [p.lng, p.lat]),
    instructions: true,
    elevation: false,
    // Prefer a "rounder" walk when the graph allows (not pure shortest)
    preference: 'recommended' as const,
    // Foot profile already excludes motorways. avoid_features "highways" is
    // driving-only on public ORS; use foot-safe avoids instead.
    options: {
      avoid_features: ['ferries', 'fords'] as string[],
    },
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: key,
      'Content-Type': 'application/json',
      Accept: 'application/geo+json, application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  })
  if (!res.ok) {
    if (env('DEBUG_ROUTING') === '1') {
      console.warn('[ors]', res.status, await res.text().catch(() => ''))
    }
    return null
  }
  const data = (await res.json()) as {
    features?: {
      geometry?: { coordinates: [number, number][] }
      properties?: {
        summary?: { distance?: number; duration?: number }
        segments?: {
          steps?: {
            instruction?: string
            distance?: number
            way_points?: [number, number]
          }[]
        }[]
      }
    }[]
  }
  const feature = data.features?.[0]
  if (!feature?.geometry?.coordinates?.length) return null
  const path = feature.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }))
  const distance =
    feature.properties?.summary?.distance ?? pathLengthMeters(path)
  const duration = feature.properties?.summary?.duration ?? 0
  const steps: OsrmStep[] = []
  for (const seg of feature.properties?.segments ?? []) {
    for (const s of seg.steps ?? []) {
      steps.push({
        name: s.instruction,
        distance: s.distance,
        maneuver: {
          type: 'turn',
          modifier: s.instruction,
          location: s.way_points
            ? [path[s.way_points[0]]?.lng ?? 0, path[s.way_points[0]]?.lat ?? 0]
            : undefined,
        },
      })
    }
  }
  return { path, distance, duration, steps }
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
  }
}

function stepsToTurns(
  path: Point[],
  steps: OsrmStep[],
  announceMeters: number,
): RouteTurn[] {
  const turns: RouteTurn[] = []
  for (const step of steps) {
    const type = step.maneuver?.type ?? ''
    if (type === 'depart' || type === 'arrive' || type === 'new name') continue
    const loc = step.maneuver?.location
    if (!loc) continue
    const point = { lng: loc[0], lat: loc[1] }
    let bestIdx = 0
    let best = Infinity
    for (let i = 0; i < path.length; i++) {
      const d = haversineMeters(path[i], point)
      if (d < best) {
        best = d
        bestIdx = i
      }
    }
    const modifier = step.maneuver?.modifier
    const road = step.name && step.name !== '' ? ` onto ${step.name}` : ''
    const instruction =
      step.name && type === 'turn'
        ? `${capitalize(modifier ?? 'turn')}${road}`
        : capitalize(modifier ? `${type} ${modifier}` : type) + road

    // Skip noise / tiny steps
    if ((step.distance ?? 0) < 12 && type === 'continue') continue

    turns.push({
      id: `turn_${turns.length}`,
      pathIndex: bestIdx,
      instruction: instruction.trim() || 'Continue',
      announceDistanceMeters: announceMeters,
    })
  }

  // Cap turn density for coaching UX
  if (turns.length > 24) {
    const step = Math.ceil(turns.length / 24)
    return turns.filter((_, i) => i % step === 0)
  }
  return turns
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

async function routeThrough(
  wps: Point[],
): Promise<{
  path: Point[]
  distance: number
  duration: number
  steps: OsrmStep[]
  provider: RoutedLoop['provider']
} | null> {
  const ors = await routeOrs(wps).catch(() => null)
  if (ors) return { ...ors, provider: 'ors' }
  const osrm = await routeOsrm(wps).catch(() => null)
  if (osrm) return { ...osrm, provider: 'osrm' }
  return null
}

/**
 * Plan a true road loop. Tries many ring geometries and picks the candidate
 * with the best distance fit *and* lowest out-and-back (corridor reuse) score.
 */
export async function planRoadLoop(input: {
  origin: Point
  distanceMeters: number
  weightKg: number
  turnAnnounceMeters: number
  startBearing?: number
}): Promise<RoutedLoop> {
  const target = Math.min(Math.max(input.distanceMeters, 400), 42_195)
  let radiusScale = 0.78
  let best: RoutedLoop | null = null
  let bestScore = Infinity
  let bestAcceptable: RoutedLoop | null = null
  let bestAcceptableScore = Infinity

  const baseBearing = input.startBearing ?? 20
  // More / varied attempts — geometry matters more than a single bearing
  const attempts = 10

  for (let attempt = 0; attempt < attempts; attempt++) {
    const bearing = (baseBearing + attempt * 29 + (attempt % 3) * 11) % 360
    // denser rings for longer runs
    const wpCount =
      target > 5000 ? 9 + (attempt % 3) : target > 2500 ? 7 + (attempt % 3) : 6 + (attempt % 3)

    const wps = loopWaypoints(input.origin, target, wpCount, radiusScale, bearing)
    const routed = await routeThrough(wps)
    if (!routed || routed.path.length < 8) {
      // shrink/grow radius even on failure
      radiusScale = Math.min(Math.max(radiusScale * 0.95, 0.35), 1.25)
      continue
    }

    const oab = outAndBackScore(routed.path)
    const turns = stepsToTurns(
      routed.path,
      routed.steps,
      input.turnAnnounceMeters,
    )
    const loop: RoutedLoop = {
      path: routed.path,
      distanceMeters: routed.distance,
      estimatedCalories: estimateCalories(routed.distance, input.weightKg),
      turns,
      provider: routed.provider,
      durationSeconds: routed.duration,
      outAndBack: oab,
    }

    const ratio = routed.distance / target
    const distPenalty = Math.abs(1 - ratio)
    // Out-and-back is expensive — prefer a slightly wrong distance over a corridor
    const score = distPenalty * 0.9 + oab * 2.4

    if (score < bestScore) {
      bestScore = score
      best = loop
    }

    const distanceOk = ratio >= 0.82 && ratio <= 1.2
    const circuitOk = oab < 0.28
    if (distanceOk && circuitOk && score < bestAcceptableScore) {
      bestAcceptableScore = score
      bestAcceptable = loop
    }

    // Early exit on a clear win
    if (ratio >= 0.9 && ratio <= 1.1 && oab < 0.16) {
      return loop
    }

    // Nudge radius toward target distance for next try
    radiusScale *= (target / Math.max(routed.distance, 1)) ** 0.85
    // If heavily out-and-back, open the ring wider next time
    if (oab > 0.35) radiusScale *= 1.08
    radiusScale = Math.min(Math.max(radiusScale, 0.35), 1.3)
  }

  // Prefer an acceptable circuit over the pure best distance score
  if (bestAcceptable) return bestAcceptable
  if (best) return best

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
