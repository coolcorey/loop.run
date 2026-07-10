/**
 * Lightweight reverse geocode for "local color" coach lines.
 * Uses OpenStreetMap Nominatim (free). Cache aggressively; be polite.
 */

export interface PlaceLabel {
  label: string
  at: number
  lat: number
  lng: number
}

let cache: PlaceLabel | null = null
const CACHE_TTL_MS = 3 * 60 * 1000
const MIN_MOVE_M = 180

function roughMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dy = (bLat - aLat) * 111_320
  const dx = (bLng - aLng) * 111_320 * Math.cos((aLat * Math.PI) / 180)
  return Math.hypot(dx, dy)
}

/**
 * Returns a short human place string, e.g. "East Cesar Chavez St" or "Austin".
 * null if unavailable.
 */
export async function reverseGeocodeLabel(
  lat: number,
  lng: number,
): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  if (
    cache &&
    Date.now() - cache.at < CACHE_TTL_MS &&
    roughMeters(cache.lat, cache.lng, lat, lng) < MIN_MOVE_M
  ) {
    return cache.label
  }

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}` +
      `&zoom=17&addressdetails=1`
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        // Nominatim usage policy: identify the app
        'User-Agent': 'LoopRunCoach/0.1 (personal training app)',
      },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return cache?.label ?? null
    const data = (await res.json()) as {
      name?: string
      address?: {
        road?: string
        pedestrian?: string
        suburb?: string
        neighbourhood?: string
        city?: string
        town?: string
        village?: string
      }
      display_name?: string
    }
    const a = data.address || {}
    const label =
      a.road ||
      a.pedestrian ||
      data.name ||
      a.neighbourhood ||
      a.suburb ||
      a.city ||
      a.town ||
      a.village ||
      null

    if (label) {
      cache = { label, at: Date.now(), lat, lng }
    }
    return label
  } catch {
    return cache?.label ?? null
  }
}
