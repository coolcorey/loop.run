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
export function loopWaypoints(
  origin: Point,
  targetMeters: number,
  count = 5,
  radiusScale = 0.72,
  startBearing = 15,
): Point[] {
  const radius = (targetMeters / (2 * Math.PI)) * radiusScale
  const points: Point[] = [origin]
  for (let i = 1; i <= count; i++) {
    const bearing = startBearing + (360 * i) / (count + 1)
    points.push(destinationPoint(origin, radius, bearing))
  }
  points.push(origin)
  return points
}

export function estimateCalories(distanceMeters: number, weightKg: number): number {
  const km = distanceMeters / 1000
  return Math.round(km * weightKg * 1.036)
}

export function distanceForCalories(calories: number, weightKg: number): number {
  if (weightKg <= 0) return 0
  return (calories / (weightKg * 1.036)) * 1000
}
