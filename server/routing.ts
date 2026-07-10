import {
  doubleBackScore,
  estimateCalories,
  haversineMeters,
  loopWaypoints,
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
  const url =
    `${base.replace(/\/$/, '')}/route/v1/foot/${coordsParam(points)}` +
    `?overview=full&geometries=geojson&steps=true&continue_straight=true`

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

export async function planRoadLoop(input: {
  origin: Point
  distanceMeters: number
  weightKg: number
  turnAnnounceMeters: number
  startBearing?: number
}): Promise<RoutedLoop> {
  let target = Math.min(Math.max(input.distanceMeters, 400), 42_195)
  let radiusScale = 0.68
  let best: RoutedLoop | null = null
  let bestScore = Infinity
  let provider: RoutedLoop['provider'] = 'osrm'

  // More attempts + more ring waypoints reduce out-and-back corridors
  for (let attempt = 0; attempt < 6; attempt++) {
    const bearing = (input.startBearing ?? 20) + attempt * 37
    const wpCount = 6 + (attempt % 2) // 6 or 7 around the ring
    const wps = loopWaypoints(input.origin, target, wpCount, radiusScale, bearing)

    let routed = await routeOrs(wps).catch(() => null)
    if (routed) {
      provider = 'ors'
    } else {
      routed = await routeOsrm(wps).catch(() => null)
      if (routed) provider = 'osrm'
    }

    if (!routed || routed.path.length < 4) {
      continue
    }

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
      provider,
      durationSeconds: routed.duration,
    }

    const ratio = routed.distance / target
    const distPenalty = Math.abs(1 - ratio)
    const reversePenalty = doubleBackScore(routed.path) * 2.5
    const score = distPenalty + reversePenalty

    if (score < bestScore) {
      bestScore = score
      best = loop
    }

    // Accept good distance AND low doubling-back
    if (ratio >= 0.88 && ratio <= 1.12 && reversePenalty < 0.35) {
      return loop
    }
    // Adjust radius for next attempt (road networks often lengthen geometry)
    radiusScale *= (target / Math.max(routed.distance, 1)) ** 0.9
    radiusScale = Math.min(Math.max(radiusScale, 0.28), 1.2)
  }

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
