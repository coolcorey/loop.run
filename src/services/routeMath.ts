import type { GeoPoint } from '@/types'
import { haversineMeters } from '@/services/geo'

export interface SnapResult {
  /** Closest point on the polyline */
  snapped: GeoPoint
  /** Meters from GPS fix to the path */
  distanceToPath: number
  /** Segment index [i, i+1] */
  segmentIndex: number
  /** 0–1 along that segment */
  t: number
  /** Meters from path start to the snap point */
  alongMeters: number
}

/** Cumulative distance at each vertex (meters). length === path.length */
export function cumulativeDistances(path: GeoPoint[]): number[] {
  const cum = [0]
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + haversineMeters(path[i - 1], path[i]))
  }
  return cum
}

export function pathTotalMeters(path: GeoPoint[]): number {
  if (path.length < 2) return 0
  const cum = cumulativeDistances(path)
  return cum[cum.length - 1]
}

/**
 * Project point P onto segment AB in lat/lng using local equirectangular approx.
 */
function projectOnSegment(
  p: GeoPoint,
  a: GeoPoint,
  b: GeoPoint,
): { point: GeoPoint; t: number; dist: number } {
  const lat0 = ((a.lat + b.lat) / 2) * (Math.PI / 180)
  const mx = 111_320 * Math.cos(lat0)
  const my = 111_320

  const ax = a.lng * mx
  const ay = a.lat * my
  const bx = b.lng * mx
  const by = b.lat * my
  const px = p.lng * mx
  const py = p.lat * my

  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const ab2 = abx * abx + aby * aby
  let t = ab2 <= 1e-9 ? 0 : (apx * abx + apy * aby) / ab2
  t = Math.max(0, Math.min(1, t))

  const qx = ax + t * abx
  const qy = ay + t * aby
  const point: GeoPoint = {
    lat: qy / my,
    lng: qx / mx,
  }
  return { point, t, dist: haversineMeters(p, point) }
}

/** Snap a GPS fix to the nearest point on the route polyline. */
export function snapToPath(path: GeoPoint[], point: GeoPoint): SnapResult | null {
  if (path.length < 2) return null

  const cum = cumulativeDistances(path)
  let best: SnapResult | null = null

  for (let i = 0; i < path.length - 1; i++) {
    const { point: snapped, t, dist } = projectOnSegment(point, path[i], path[i + 1])
    const alongMeters = cum[i] + t * (cum[i + 1] - cum[i])
    if (!best || dist < best.distanceToPath) {
      best = {
        snapped,
        distanceToPath: dist,
        segmentIndex: i,
        t,
        alongMeters,
      }
    }
  }
  return best
}

export function distanceToStart(path: GeoPoint[], point: GeoPoint): number {
  if (!path.length) return Infinity
  return haversineMeters(point, path[0])
}

/**
 * Loop finish: covered most of the route and returned near the start.
 */
export function detectLoopFinish(opts: {
  alongMeters: number
  totalMeters: number
  distanceToStartMeters: number
  /** min fraction along route before finish is allowed */
  minAlongFraction?: number
  /** meters from start to count as "home" */
  startRadiusMeters?: number
}): boolean {
  const {
    alongMeters,
    totalMeters,
    distanceToStartMeters,
    minAlongFraction = 0.88,
    startRadiusMeters = 45,
  } = opts
  if (totalMeters < 200) return false
  if (alongMeters < totalMeters * minAlongFraction) return false
  return distanceToStartMeters <= startRadiusMeters
}

/** Split boundary every unit distance (mi or km). */
export function splitBoundaryMeters(unit: 'mi' | 'km'): number {
  return unit === 'mi' ? 1609.344 : 1000
}

/**
 * Monotonic progress: only advance along-route when snap is ahead and not a huge jump.
 */
export function advanceAlong(
  prevAlong: number,
  snapAlong: number,
  totalMeters: number,
): number {
  if (snapAlong + 5 < prevAlong) {
    // Small backward noise — keep prev; big reverse near end might be loop wrap
    if (prevAlong > totalMeters * 0.85 && snapAlong < totalMeters * 0.15) {
      // near finish wrapping to start — treat as full loop progress
      return Math.max(prevAlong, totalMeters)
    }
    return prevAlong
  }
  // Cap forward jump (GPS teleport along path)
  const maxStep = 80
  if (snapAlong - prevAlong > maxStep) {
    return prevAlong + maxStep
  }
  return Math.min(snapAlong, totalMeters)
}
