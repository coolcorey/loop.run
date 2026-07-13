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
 * Places origin ON a ring (not at the center) so via-points force a circuit
 * instead of a star that routers collapse into out-and-back corridors.
 */
export function loopWaypoints(
  origin: Point,
  targetMeters: number,
  count = 8,
  radiusScale = 0.72,
  startBearing = 15,
): Point[] {
  const n = Math.max(4, Math.min(14, Math.round(count)))
  const radius = (targetMeters / (2 * Math.PI)) * radiusScale
  // Center of the circle: opposite the first leg so `origin` sits on the circumference
  const center = destinationPoint(origin, radius, startBearing + 180)
  const points: Point[] = [origin]
  // Walk around the ring; skip i=0 (origin already placed)
  for (let i = 1; i < n; i++) {
    // Bearing of origin from center is `startBearing`
    const bearingFromCenter = startBearing + (360 * i) / n
    // Mild radius wobble keeps routers from snapping every via to one arterial
    const r = radius * (0.9 + 0.14 * Math.sin(i * 2.3 + startBearing * 0.01))
    points.push(destinationPoint(center, r, bearingFromCenter))
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
 * Score how much the path doubles back via heading reversals (higher = worse).
 * Catches sharp U-turns; misses "same street later" — use corridorReuseScore too.
 */
export function doubleBackScore(path: Point[]): number {
  if (path.length < 6) return 0
  const step = Math.max(1, Math.floor(path.length / 50))
  let reversals = 0
  let samples = 0
  let prevBearing: number | null = null
  for (let i = step; i < path.length; i += step) {
    const b = bearingDeg(path[i - step], path[i])
    if (prevBearing != null) {
      samples++
      if (angleDiff(prevBearing, b) > 145) reversals++
    }
    prevBearing = b
  }
  if (samples === 0) return 0
  return reversals / samples
}

/**
 * Fraction of path samples that pass near an earlier/later stretch of the same
 * route (classic out-and-back: go down a road, return the same way).
 * 0 = clean circuit, 1 = entire path is a double-traced corridor.
 */
export function corridorReuseScore(
  path: Point[],
  opts?: { sampleEveryM?: number; minAlongM?: number; nearM?: number },
): number {
  if (path.length < 8) return 0
  // Tighter defaults catch “same sidewalk twice” switchbacks better
  const sampleEveryM = opts?.sampleEveryM ?? 35
  const minAlongM = opts?.minAlongM ?? 120
  const nearM = opts?.nearM ?? 35

  const samples: { p: Point; d: number }[] = [{ p: path[0]!, d: 0 }]
  let acc = 0
  for (let i = 1; i < path.length; i++) {
    acc += haversineMeters(path[i - 1]!, path[i]!)
    const last = samples[samples.length - 1]!
    if (acc - last.d >= sampleEveryM) {
      samples.push({ p: path[i]!, d: acc })
    }
  }
  if (samples.length < 6) return 0

  let bad = 0
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i]!
    let hit = false
    for (let j = 0; j < samples.length; j++) {
      if (Math.abs(samples[j]!.d - a.d) < minAlongM) continue
      if (haversineMeters(a.p, samples[j]!.p) < nearM) {
        hit = true
        break
      }
    }
    if (hit) bad++
  }
  return bad / samples.length
}

/**
 * How well the path surrounds its centroid (0 = full angular coverage, 1 = thin corridor).
 * Out-and-backs leave most compass sectors empty.
 */
export function angularThinnessScore(path: Point[], bins = 12): number {
  if (path.length < 8) return 1
  let lat = 0
  let lng = 0
  const step = Math.max(1, Math.floor(path.length / 60))
  let n = 0
  for (let i = 0; i < path.length; i += step) {
    lat += path[i]!.lat
    lng += path[i]!.lng
    n++
  }
  const center = { lat: lat / n, lng: lng / n }
  const occupied = new Array<boolean>(bins).fill(false)
  for (let i = 0; i < path.length; i += step) {
    const b = bearingDeg(center, path[i]!)
    occupied[Math.floor(b / (360 / bins)) % bins] = true
  }
  const filled = occupied.filter(Boolean).length
  return 1 - filled / bins
}

/**
 * Combined "how out-and-back is this?" score (higher = worse). ~0 good, ~1+ bad.
 */
export function outAndBackScore(path: Point[]): number {
  const reverse = doubleBackScore(path)
  const reuse = corridorReuseScore(path)
  const thin = angularThinnessScore(path)
  // Reuse dominates — that's the "same road twice" problem runners hate
  return reuse * 3.2 + reverse * 1.2 + thin * 1.4
}

export function estimateCalories(distanceMeters: number, weightKg: number): number {
  const km = distanceMeters / 1000
  return Math.round(km * weightKg * 1.036)
}

export function distanceForCalories(calories: number, weightKg: number): number {
  if (weightKg <= 0) return 0
  return (calories / (weightKg * 1.036)) * 1000
}
