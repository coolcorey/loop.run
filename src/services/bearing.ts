import type { GeoPoint } from '@/types'

/** Initial bearing from A → B in degrees [0, 360), clockwise from north. */
export function bearingDegrees(a: GeoPoint, b: GeoPoint): number {
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  const θ = Math.atan2(y, x)
  return ((θ * 180) / Math.PI + 360) % 360
}

/**
 * Prefer device heading when moving; otherwise derive from track.
 * Returns null if we can't trust a direction yet.
 */
export function resolveHeading(
  point: GeoPoint,
  previous: GeoPoint | null,
): number | null {
  const device = point.heading
  const speed = point.speed

  // GPS heading is often junk when nearly stationary
  const moving =
    speed != null && Number.isFinite(speed) && speed >= 0.7 /* ~1.5 mph */

  if (
    moving &&
    device != null &&
    Number.isFinite(device) &&
    device >= 0
  ) {
    return device
  }

  if (previous && moving) {
    return bearingDegrees(previous, point)
  }

  // Slow but have a device heading
  if (device != null && Number.isFinite(device) && device >= 0) {
    return device
  }

  if (previous) {
    const dlat = Math.abs(point.lat - previous.lat)
    const dlng = Math.abs(point.lng - previous.lng)
    // Only use track bearing if we actually moved a bit
    if (dlat > 1e-6 || dlng > 1e-6) {
      return bearingDegrees(previous, point)
    }
  }

  return null
}
