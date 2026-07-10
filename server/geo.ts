export interface Point {
  lat: number
  lng: number
}

export function haversineMeters(a: Point, b: Point): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function pathLengthMeters(path: Point[]): number {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    total += haversineMeters(path[i - 1], path[i])
  }
  return total
}

/** Destination point given distance (m) and bearing (deg from north) */
export function destinationPoint(
  origin: Point,
  distanceMeters: number,
  bearingDeg: number,
): Point {
  const R = 6371000
  const δ = distanceMeters / R
  const θ = (bearingDeg * Math.PI) / 180
  const φ1 = (origin.lat * Math.PI) / 180
  const λ1 = (origin.lng * Math.PI) / 180

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  )
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    )

  return {
    lat: (φ2 * 180) / Math.PI,
    lng: (((λ2 * 180) / Math.PI + 540) % 360) - 180,
  }
}

/**
 * Waypoints for a closed loop of ~target meters.
 * Roads stretch the path, so radius starts below circumference ideal.
 */
/**
 * Waypoints for a closed loop of ~target meters.
 * Even angular spacing around a ring (not a line out-and-back).
 * Roads stretch the path, so radius starts below circumference ideal.
 */
export function loopWaypoints(
  origin: Point,
  targetMeters: number,
  count = 6,
  radiusScale = 0.72,
  startBearing = 15,
): Point[] {
  const radius = (targetMeters / (2 * Math.PI)) * radiusScale
  const points: Point[] = [origin]
  // Even pie slices — never collinear reverse
  for (let i = 1; i <= count; i++) {
    const bearing = startBearing + (360 * i) / (count + 1)
    // Slight radius jitter so the router is less likely to collapse to a corridor
    const r = radius * (0.92 + 0.12 * Math.sin(i * 1.7))
    points.push(destinationPoint(origin, r, bearing))
  }
  points.push(origin)
  return points
}

/** Rough bearing A→B in degrees [0,360) */
export function bearingDeg(a: Point, b: Point): number {
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

function angleDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360
  if (d > 180) d = 360 - d
  return d
}

/**
 * Score how much the path doubles back (higher = worse).
 * Samples successive path headings; sharp reversals (~>150°) look like out-and-backs.
 */
export function doubleBackScore(path: Point[]): number {
  if (path.length < 6) return 0
  // Sample every Nth vertex for speed
  const step = Math.max(1, Math.floor(path.length / 40))
  let reversals = 0
  let samples = 0
  let prevBearing: number | null = null
  for (let i = step; i < path.length; i += step) {
    const b = bearingDeg(path[i - step], path[i])
    if (prevBearing != null) {
      samples++
      if (angleDiff(prevBearing, b) > 150) reversals++
    }
    prevBearing = b
  }
  if (samples === 0) return 0
  return reversals / samples
}

export function estimateCalories(distanceMeters: number, weightKg: number): number {
  const km = distanceMeters / 1000
  return Math.round(km * weightKg * 1.036)
}

export function distanceForCalories(calories: number, weightKg: number): number {
  if (weightKg <= 0) return 0
  return (calories / (weightKg * 1.036)) * 1000
}
