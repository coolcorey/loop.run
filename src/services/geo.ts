import type { DistanceUnit, GeoPoint } from '@/types'

const MI_TO_M = 1609.344
const KM_TO_M = 1000

export function toMeters(value: number, unit: DistanceUnit): number {
  return unit === 'mi' ? value * MI_TO_M : value * KM_TO_M
}

export function fromMeters(meters: number, unit: DistanceUnit): number {
  return unit === 'mi' ? meters / MI_TO_M : meters / KM_TO_M
}

export function formatDistance(meters: number, unit: DistanceUnit, digits = 2): string {
  return `${fromMeters(meters, unit).toFixed(digits)} ${unit}`
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

export function formatPace(secondsPerUnit: number): string {
  if (!Number.isFinite(secondsPerUnit) || secondsPerUnit <= 0) return '—'
  const m = Math.floor(secondsPerUnit / 60)
  const s = Math.round(secondsPerUnit % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Haversine distance in meters */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
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

export function pathLengthMeters(path: GeoPoint[]): number {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    total += haversineMeters(path[i - 1], path[i])
  }
  return total
}

/**
 * Rough calorie estimate (running).
 * MET-style ballpark: ~1 kcal per kg per km at easy effort.
 * Good enough until we refine with AI / HR.
 */
export function estimateCalories(distanceMeters: number, weightKg: number): number {
  const km = distanceMeters / 1000
  return Math.round(km * weightKg * 1.036)
}

/** Distance needed to burn approx calories */
export function distanceForCalories(
  calories: number,
  weightKg: number,
): number {
  if (weightKg <= 0) return 0
  const km = calories / (weightKg * 1.036)
  return km * 1000
}

/**
 * Placeholder closed loop around a center point.
 * Real map routing (OSRM / Mapbox / Google) replaces this later;
 * AI can choose heading / parks / avoid hills on top of a router.
 */
export function mockLoopPath(
  center: GeoPoint,
  distanceMeters: number,
  points = 48,
  /** Rotate the loop (degrees) so “different route” is visible offline */
  startBearingDeg = 0,
): GeoPoint[] {
  // Approximate radius so circumference ≈ distance
  const radiusM = distanceMeters / (2 * Math.PI)
  const path: GeoPoint[] = []
  const metersPerDegLat = 111_320
  const metersPerDegLng = 111_320 * Math.cos((center.lat * Math.PI) / 180)
  const offset = (startBearingDeg * Math.PI) / 180

  for (let i = 0; i <= points; i++) {
    const theta = (i / points) * 2 * Math.PI + offset
    // Slight ellipse so it doesn't look like a perfect circle
    const r = radiusM * (1 + 0.08 * Math.sin(2 * theta))
    path.push({
      lat: center.lat + (r * Math.cos(theta)) / metersPerDegLat,
      lng: center.lng + (r * Math.sin(theta)) / metersPerDegLng,
    })
  }
  return path
}

/** Fallback when GPS denied — downtown-ish placeholder */
export const FALLBACK_ORIGIN: GeoPoint = {
  lat: 39.7392,
  lng: -104.9903,
}

export type GeoFailureCode =
  | 'unsupported'
  | 'insecure'
  | 'permission'
  | 'unavailable'
  | 'timeout'
  | 'unknown'

export class GeoError extends Error {
  code: GeoFailureCode
  constructor(message: string, code: GeoFailureCode) {
    super(message)
    this.name = 'GeoError'
    this.code = code
  }
}

export function isSecureGeoContext(): boolean {
  if (typeof window === 'undefined') return false
  // http://localhost and https:// are fine; http://192.168.x.x is NOT
  return window.isSecureContext === true
}

function positionToPoint(pos: GeolocationPosition): GeoPoint {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    altitude: pos.coords.altitude ?? undefined,
    accuracy: pos.coords.accuracy,
    speed: pos.coords.speed ?? undefined,
    heading: pos.coords.heading ?? undefined,
    timestamp: pos.timestamp,
  }
}

function mapGeoError(err: GeolocationPositionError | Error | unknown): GeoError {
  if (err instanceof GeoError) return err

  const code =
    err && typeof err === 'object' && 'code' in err
      ? (err as GeolocationPositionError).code
      : undefined

  // 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT
  if (code === 1) {
    return new GeoError(
      'Location permission denied. Allow location for this site in the browser address bar / site settings, then try again.',
      'permission',
    )
  }
  if (code === 2) {
    return new GeoError(
      'Position unavailable. Turn on device location / GPS and try again (outdoors helps).',
      'unavailable',
    )
  }
  if (code === 3) {
    return new GeoError(
      'Location timed out. Move near a window or outdoors and try again.',
      'timeout',
    )
  }

  if (err instanceof Error && err.message) {
    return new GeoError(err.message, 'unknown')
  }
  return new GeoError('Could not get location.', 'unknown')
}

/**
 * getCurrentPosition that ALWAYS settles.
 * Some mobile browsers ignore the built-in `timeout` with high accuracy —
 * we enforce our own failsafe so the UI never hangs forever.
 */
function getPositionOnce(options: PositionOptions): Promise<GeoPoint> {
  const browserTimeout = options.timeout ?? 10_000
  // Fail a bit after the browser timeout in case the engine never fires
  const failsafeMs = browserTimeout + 1_500

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(failsafe)
      fn()
    }

    const failsafe = setTimeout(() => {
      finish(() =>
        reject(
          new GeoError(
            'Location timed out. Try again, or check that Location is on for the browser.',
            'timeout',
          ),
        ),
      )
    }, failsafeMs)

    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => finish(() => resolve(positionToPoint(pos))),
        (err) => finish(() => reject(err)),
        options,
      )
    } catch (e) {
      finish(() => reject(e))
    }
  })
}

function withWallClockTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new GeoError(message, 'timeout')), ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

export interface GetPositionOptions {
  /** Hard cap for the whole attempt (default 12s) */
  maxWaitMs?: number
  /** Prefer a fresh GPS fix (slower). Default false = allow recent cache. */
  forceFresh?: boolean
}

/**
 * Get current position without hanging the UI.
 *
 * Strategy:
 * 1) Fast: last-known / network (cached up to a few minutes)
 * 2) Race: low-accuracy + high-accuracy in parallel
 * 3) Hard wall-clock timeout so callers always get success or error
 *
 * Note: we intentionally skip navigator.permissions.query — it hangs on some
 * Android Chrome builds and blocked us after switching to HTTPS.
 */
export async function getCurrentPosition(
  opts: GetPositionOptions = {},
): Promise<GeoPoint> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new GeoError(
      'This browser does not support geolocation.',
      'unsupported',
    )
  }

  if (!isSecureGeoContext()) {
    throw new GeoError(
      'Location requires HTTPS (or localhost). Open Loop via https://… or http://localhost — not a raw LAN IP over http://.',
      'insecure',
    )
  }

  const maxWait = opts.maxWaitMs ?? 12_000
  const maxAge = opts.forceFresh ? 0 : 180_000

  // 1) Fast path — often returns in <1s with a recent fix
  if (!opts.forceFresh) {
    try {
      return await getPositionOnce({
        enableHighAccuracy: false,
        timeout: Math.min(4_000, maxWait),
        maximumAge: maxAge,
      })
    } catch {
      // continue to live fixes
    }
  }

  // 2) Race coarse + fine; first success wins
  const live = Promise.any([
    getPositionOnce({
      enableHighAccuracy: false,
      timeout: Math.min(8_000, maxWait),
      maximumAge: opts.forceFresh ? 0 : 15_000,
    }),
    getPositionOnce({
      enableHighAccuracy: true,
      timeout: Math.min(10_000, maxWait),
      maximumAge: opts.forceFresh ? 0 : 5_000,
    }),
  ]).catch((agg: unknown) => {
    // Promise.any failed — surface a useful error from the set
    const errors =
      agg && typeof agg === 'object' && 'errors' in agg
        ? (agg as AggregateError).errors
        : [agg]
    for (const e of errors) {
      const mapped = mapGeoError(e)
      if (mapped.code === 'permission') throw mapped
    }
    throw mapGeoError(errors[0] ?? agg)
  })

  try {
    return await withWallClockTimeout(
      live,
      maxWait,
      'Location timed out. Move near a window, ensure Location is on, and try again.',
    )
  } catch (e) {
    throw mapGeoError(e)
  }
}

/** Human-readable status for Settings / diagnostics */
export function geoDiagnostics(): string[] {
  const lines: string[] = []
  lines.push(
    `Secure context: ${isSecureGeoContext() ? 'yes' : 'NO — GPS will fail'}`,
  )
  lines.push(`Page URL: ${typeof location !== 'undefined' ? location.origin : '?'}`)
  lines.push(
    `Geolocation API: ${typeof navigator !== 'undefined' && 'geolocation' in navigator ? 'yes' : 'no'}`,
  )
  return lines
}
