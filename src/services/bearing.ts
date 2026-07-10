import type { GeoPoint } from '@/types'
import { haversineMeters } from '@/services/geo'

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

const STILL_MPS = 0.75
const MIN_TRACK_METERS = 2.5

/**
 * Direction for the map arrow / heading-up camera.
 *
 * - Moving: always use track bearing (path of travel). Phone orientation
 *   (pocket, sideways) must not matter.
 * - Standing still: allow GPS/device heading if present (compass-like).
 */
export function resolveHeading(
  point: GeoPoint,
  previous: GeoPoint | null,
): number | null {
  const speed = point.speed
  const moving =
    (speed != null && Number.isFinite(speed) && speed >= STILL_MPS) ||
    (previous != null &&
      haversineMeters(previous, point) >= MIN_TRACK_METERS)

  if (moving && previous) {
    const dist = haversineMeters(previous, point)
    if (dist >= MIN_TRACK_METERS) {
      return bearingDegrees(previous, point)
    }
    // Moving but tiny step — keep previous track if we just had one via caller smoothing
    return null
  }

  // Stationary: device/GPS heading is OK (points where the phone thinks "forward")
  const device = point.heading
  if (device != null && Number.isFinite(device) && device >= 0) {
    return device
  }

  return null
}
