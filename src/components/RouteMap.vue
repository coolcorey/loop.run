<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl, { type GeoJSONSource, type Map as MaplibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { GeoPoint } from '@/types'
import { haversineMeters } from '@/services/geo'
import { speedToColor } from '@/services/speedColor'

const props = withDefaults(
  defineProps<{
    path?: GeoPoint[]
    user?: GeoPoint | null
    /** Live GPS track samples (for speed-colored trail) */
    trail?: GeoPoint[]
    /** Degrees from north; used for marker + heading-up camera */
    heading?: number | null
    /**
     * overview — fit whole route (Plan)
     * follow — keep user centered (Run)
     */
    mode?: 'overview' | 'follow'
    /** When following: rotate map so travel direction is up */
    headingUp?: boolean
    height?: string
    interactive?: boolean
  }>(),
  {
    path: () => [],
    user: null,
    trail: () => [],
    heading: null,
    mode: 'overview',
    headingUp: true,
    height: '220px',
    interactive: true,
  },
)

const el = ref<HTMLDivElement | null>(null)
let map: MaplibreMap | null = null
let followReady = false

const STYLE =
  (import.meta.env.VITE_MAP_STYLE as string | undefined) ||
  'https://tiles.openfreemap.org/styles/dark'

const FOLLOW_ZOOM = 16.2

type LngLat = [number, number]
type FeatureCollection = {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    properties: Record<string, string | number>
    geometry:
      | { type: 'LineString'; coordinates: LngLat[] }
      | { type: 'Point'; coordinates: LngLat }
  }[]
}

function emptyFc(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

function pathGeoJson(path: GeoPoint[]): FeatureCollection {
  if (path.length < 2) return emptyFc()
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: path.map((p) => [p.lng, p.lat] as LngLat),
        },
      },
    ],
  }
}

/** Build short segments colored by segment speed */
function trailGeoJson(trail: GeoPoint[]): FeatureCollection {
  const features: FeatureCollection['features'] = []
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1]
    const b = trail[i]
    const dist = haversineMeters(a, b)
    if (dist < 0.8) continue

    let speed = b.speed
    if (speed == null || !Number.isFinite(speed) || speed < 0) {
      const dt = ((b.timestamp ?? 0) - (a.timestamp ?? 0)) / 1000 || 1
      speed = dt > 0 ? dist / dt : 0
    }

    features.push({
      type: 'Feature',
      properties: {
        color: speedToColor(speed),
        speed,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [a.lng, a.lat],
          [b.lng, b.lat],
        ],
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

function userGeoJson(
  user: GeoPoint | null,
  heading: number | null,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: user
      ? [
          {
            type: 'Feature',
            properties: {
              bearing: props.headingUp ? 0 : (heading ?? 0),
              accuracy: user.accuracy ?? 0,
            },
            geometry: {
              type: 'Point',
              coordinates: [user.lng, user.lat],
            },
          },
        ]
      : [],
  }
}

function addChevronImage() {
  if (!map || map.hasImage('user-chevron')) return
  const size = 96
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, size, size)

  // Outer glow
  const grd = ctx.createRadialGradient(
    size / 2,
    size / 2,
    8,
    size / 2,
    size / 2,
    40,
  )
  grd.addColorStop(0, 'rgba(255, 138, 91, 0.35)')
  grd.addColorStop(1, 'rgba(255, 138, 91, 0)')
  ctx.fillStyle = grd
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, 40, 0, Math.PI * 2)
  ctx.fill()

  // Disc
  ctx.beginPath()
  ctx.arc(size / 2, size / 2 + 4, 18, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(15, 20, 25, 0.75)'
  ctx.fill()

  // Chevron pointing up
  ctx.beginPath()
  ctx.moveTo(size / 2, 12)
  ctx.lineTo(size - 18, size - 16)
  ctx.lineTo(size / 2, size - 28)
  ctx.lineTo(18, size - 16)
  ctx.closePath()
  ctx.fillStyle = '#ff8a5b'
  ctx.strokeStyle = '#f8fafc'
  ctx.lineWidth = 4
  ctx.lineJoin = 'round'
  ctx.fill()
  ctx.stroke()

  map.addImage('user-chevron', ctx.getImageData(0, 0, size, size), {
    pixelRatio: 2,
  })
}

function ensureLayers() {
  if (!map) return
  addChevronImage()

  // Planned route (muted underlay)
  if (!map.getSource('route')) {
    map.addSource('route', {
      type: 'geojson',
      data: pathGeoJson(props.path),
    })
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      paint: {
        'line-color': '#3dd6c6',
        'line-width': props.mode === 'follow' ? 3.5 : 4.5,
        'line-opacity': props.mode === 'follow' ? 0.35 : 0.95,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    })
  }

  // Speed-colored completed trail
  if (!map.getSource('trail')) {
    map.addSource('trail', {
      type: 'geojson',
      data: trailGeoJson(props.trail),
    })
    map.addLayer({
      id: 'trail-line',
      type: 'line',
      source: 'trail',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 6,
        'line-opacity': 0.95,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    })
  }

  // Accuracy halo + runner chevron on top
  if (!map.getSource('user')) {
    map.addSource('user', {
      type: 'geojson',
      data: userGeoJson(props.user, props.heading),
    })
    map.addLayer({
      id: 'user-accuracy',
      type: 'circle',
      source: 'user',
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          10,
          17,
          22,
        ],
        'circle-color': '#ff8a5b',
        'circle-opacity': 0.18,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#ff8a5b',
        'circle-stroke-opacity': 0.4,
      },
    })
    map.addLayer({
      id: 'user-chevron',
      type: 'symbol',
      source: 'user',
      layout: {
        'icon-image': 'user-chevron',
        'icon-size': 1.05,
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })
  }
}

function syncOverview() {
  if (!map) return
  const bounds = new maplibregl.LngLatBounds()
  let has = false
  for (const p of props.path) {
    bounds.extend([p.lng, p.lat])
    has = true
  }
  for (const p of props.trail) {
    bounds.extend([p.lng, p.lat])
    has = true
  }
  if (props.user) {
    bounds.extend([props.user.lng, props.user.lat])
    has = true
  }
  if (has) {
    map.fitBounds(bounds, { padding: 36, maxZoom: 15, duration: 400 })
  }
  map.easeTo({ bearing: 0, duration: 300 })
}

function syncFollow() {
  if (!map || !props.user) return

  const bearing =
    props.headingUp && props.heading != null && Number.isFinite(props.heading)
      ? props.heading
      : 0

  const zoom = followReady
    ? Math.max(map.getZoom(), FOLLOW_ZOOM - 0.5)
    : FOLLOW_ZOOM

  map.easeTo({
    center: [props.user.lng, props.user.lat],
    zoom,
    bearing,
    duration: followReady ? 350 : 0,
    essential: true,
    easing: (t) => t * (2 - t),
  })
  followReady = true
}

function syncData() {
  if (!map) return
  const route = map.getSource('route') as GeoJSONSource | undefined
  const trail = map.getSource('trail') as GeoJSONSource | undefined
  const user = map.getSource('user') as GeoJSONSource | undefined
  route?.setData(pathGeoJson(props.path))
  trail?.setData(trailGeoJson(props.trail))
  user?.setData(userGeoJson(props.user, props.heading))

  // Dim planned route when we have a live trail
  if (map.getLayer('route-line')) {
    map.setPaintProperty(
      'route-line',
      'line-opacity',
      props.mode === 'follow' || props.trail.length > 1 ? 0.35 : 0.95,
    )
  }

  if (props.mode === 'follow' && props.user) {
    syncFollow()
  } else if (props.mode === 'overview') {
    followReady = false
    syncOverview()
  }
}

onMounted(() => {
  if (!el.value) return

  const center: [number, number] = props.user
    ? [props.user.lng, props.user.lat]
    : props.path[0]
      ? [props.path[0].lng, props.path[0].lat]
      : [-104.99, 39.74]

  map = new maplibregl.Map({
    container: el.value,
    style: STYLE,
    center,
    zoom: props.mode === 'follow' ? FOLLOW_ZOOM : 13,
    attributionControl: { compact: true },
    interactive: props.interactive,
    bearingSnap: 0,
  })

  map.addControl(
    new maplibregl.NavigationControl({
      showCompass: true,
      visualizePitch: false,
    }),
    'top-right',
  )

  map.on('load', () => {
    ensureLayers()
    syncData()
  })
})

watch(
  () =>
    [
      props.path,
      props.user,
      props.trail,
      props.heading,
      props.mode,
      props.headingUp,
    ] as const,
  () => {
    if (!map?.isStyleLoaded()) return
    ensureLayers()
    syncData()
  },
  { deep: true },
)

onBeforeUnmount(() => {
  map?.remove()
  map = null
})
</script>

<template>
  <div class="route-map" :style="{ height }">
    <div ref="el" class="route-map-canvas" />
  </div>
</template>

<style scoped>
.route-map {
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: #0b0f14;
}

.route-map-canvas {
  width: 100%;
  height: 100%;
}

.route-map :deep(.maplibregl-ctrl-attrib) {
  font-size: 10px;
  background: rgba(15, 20, 25, 0.7);
  color: var(--muted);
}

.route-map :deep(.maplibregl-ctrl-group) {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}

.route-map :deep(.maplibregl-ctrl-group button) {
  background: transparent;
}
</style>
