<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl, { type GeoJSONSource, type Map as MaplibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { GeoPoint } from '@/types'

const props = withDefaults(
  defineProps<{
    path?: GeoPoint[]
    user?: GeoPoint | null
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

function pathGeoJson(path: GeoPoint[]) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: path.map((p) => [p.lng, p.lat]),
    },
  }
}

function userGeoJson(user: GeoPoint | null, heading: number | null) {
  return {
    type: 'FeatureCollection' as const,
    features: user
      ? [
          {
            type: 'Feature' as const,
            properties: {
              // When heading-up, map already rotates — keep chevron pointing "up"
              bearing: props.headingUp ? 0 : (heading ?? 0),
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [user.lng, user.lat],
            },
          },
        ]
      : [],
  }
}

function addChevronImage() {
  if (!map || map.hasImage('user-chevron')) return
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, size, size)
  // Soft halo
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, 22, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(15, 20, 25, 0.55)'
  ctx.fill()

  // Chevron pointing up (travel direction when heading-up)
  ctx.beginPath()
  ctx.moveTo(size / 2, 10)
  ctx.lineTo(size - 14, size - 14)
  ctx.lineTo(size / 2, size - 22)
  ctx.lineTo(14, size - 14)
  ctx.closePath()
  ctx.fillStyle = '#ff8a5b'
  ctx.strokeStyle = '#0f1419'
  ctx.lineWidth = 3
  ctx.fill()
  ctx.stroke()

  map.addImage('user-chevron', ctx.getImageData(0, 0, size, size), {
    pixelRatio: 2,
  })
}

function ensureLayers() {
  if (!map) return
  addChevronImage()

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
        'line-width': 4.5,
        'line-opacity': 0.95,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    })
  }

  if (!map.getSource('user')) {
    map.addSource('user', {
      type: 'geojson',
      data: userGeoJson(props.user, props.heading),
    })
    map.addLayer({
      id: 'user-chevron',
      type: 'symbol',
      source: 'user',
      layout: {
        'icon-image': 'user-chevron',
        'icon-size': 0.9,
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
  const user = map.getSource('user') as GeoJSONSource | undefined
  route?.setData(pathGeoJson(props.path))
  user?.setData(userGeoJson(props.user, props.heading))

  if (props.mode === 'follow' && props.user) {
    syncFollow()
  } else {
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
    // Avoid crazy spin when bearing jumps
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
