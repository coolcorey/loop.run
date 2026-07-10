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
    trail?: GeoPoint[]
    heading?: number | null
    mode?: 'overview' | 'follow'
    headingUp?: boolean
    height?: string
    interactive?: boolean
    /** High-contrast planned path (outdoor / sunglasses) */
    highContrastPath?: boolean
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
    highContrastPath: false,
  },
)

const el = ref<HTMLDivElement | null>(null)
let map: MaplibreMap | null = null
let followReady = false
/** User panned/zoomed — pause auto-follow until idle */
let userInteracting = false
let resumeFollowTimer: ReturnType<typeof setTimeout> | null = null
const RESUME_FOLLOW_MS = 5_000

const STYLE =
  (import.meta.env.VITE_MAP_STYLE as string | undefined) ||
  'https://tiles.openfreemap.org/styles/dark'

const FOLLOW_ZOOM = 16.4

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
  const grd = ctx.createRadialGradient(
    size / 2,
    size / 2,
    8,
    size / 2,
    size / 2,
    40,
  )
  grd.addColorStop(0, 'rgba(255, 255, 255, 0.35)')
  grd.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = grd
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, 40, 0, Math.PI * 2)
  ctx.fill()

  ctx.beginPath()
  ctx.arc(size / 2, size / 2 + 4, 20, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(15, 20, 25, 0.85)'
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(size / 2, 10)
  ctx.lineTo(size - 16, size - 14)
  ctx.lineTo(size / 2, size - 26)
  ctx.lineTo(16, size - 14)
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#0f1419'
  ctx.lineWidth = 4
  ctx.lineJoin = 'round'
  ctx.fill()
  ctx.stroke()
  // accent tip
  ctx.beginPath()
  ctx.moveTo(size / 2, 10)
  ctx.lineTo(size / 2 + 10, 28)
  ctx.lineTo(size / 2 - 10, 28)
  ctx.closePath()
  ctx.fillStyle = '#ff8a5b'
  ctx.fill()

  map.addImage('user-chevron', ctx.getImageData(0, 0, size, size), {
    pixelRatio: 2,
  })
}

function pauseFollowFromUser() {
  userInteracting = true
  if (resumeFollowTimer) clearTimeout(resumeFollowTimer)
  resumeFollowTimer = setTimeout(() => {
    userInteracting = false
    resumeFollowTimer = null
    if (props.mode === 'follow' && props.user && map?.isStyleLoaded()) {
      syncFollow(true)
    }
  }, RESUME_FOLLOW_MS)
}

function ensureLayers() {
  if (!map) return
  addChevronImage()

  if (!map.getSource('route')) {
    map.addSource('route', {
      type: 'geojson',
      data: pathGeoJson(props.path),
    })
    // White casing for outdoor contrast
    map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      paint: {
        'line-color': '#ffffff',
        'line-width': props.highContrastPath || props.mode === 'follow' ? 10 : 7,
        'line-opacity': 0.95,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    })
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      paint: {
        'line-color':
          props.highContrastPath || props.mode === 'follow'
            ? '#f5ff3d'
            : '#3dd6c6',
        'line-width': props.highContrastPath || props.mode === 'follow' ? 6 : 4.5,
        'line-opacity': 1,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    })
  }

  if (!map.getSource('trail')) {
    map.addSource('trail', {
      type: 'geojson',
      data: trailGeoJson(props.trail),
    })
    map.addLayer({
      id: 'trail-casing',
      type: 'line',
      source: 'trail',
      paint: {
        'line-color': '#0f1419',
        'line-width': 9,
        'line-opacity': 0.55,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    })
    map.addLayer({
      id: 'trail-line',
      type: 'line',
      source: 'trail',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 6,
        'line-opacity': 1,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    })
  }

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
          12,
          17,
          26,
        ],
        'circle-color': '#ffffff',
        'circle-opacity': 0.2,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.55,
      },
    })
    map.addLayer({
      id: 'user-chevron',
      type: 'symbol',
      source: 'user',
      layout: {
        'icon-image': 'user-chevron',
        'icon-size': 1.15,
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
    map.fitBounds(bounds, { padding: 28, maxZoom: 15, duration: 400 })
  }
  map.easeTo({ bearing: 0, duration: 300 })
}

function syncFollow(force = false) {
  if (!map || !props.user) return
  if (userInteracting && !force) return

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

  // Planned path stays bright; trail overlays with speed colors
  if (map.getLayer('route-line')) {
    const hi = props.highContrastPath || props.mode === 'follow'
    map.setPaintProperty('route-line', 'line-color', hi ? '#f5ff3d' : '#3dd6c6')
    map.setPaintProperty('route-line', 'line-width', hi ? 6 : 4.5)
    map.setPaintProperty(
      'route-line',
      'line-opacity',
      props.trail.length > 2 ? 0.75 : 1,
    )
  }
  if (map.getLayer('route-casing')) {
    map.setPaintProperty(
      'route-casing',
      'line-width',
      props.highContrastPath || props.mode === 'follow' ? 10 : 7,
    )
  }

  if (props.mode === 'follow' && props.user) {
    syncFollow()
  } else if (props.mode === 'overview') {
    followReady = false
    userInteracting = false
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
    dragRotate: true,
    touchPitch: false,
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

  // Manual explore — pause auto-follow, resume after 5s idle
  map.on('dragstart', () => pauseFollowFromUser())
  map.on('rotatestart', (e) => {
    if ((e as { originalEvent?: Event }).originalEvent) pauseFollowFromUser()
  })
  map.on('zoomstart', (e) => {
    if ((e as { originalEvent?: Event }).originalEvent) pauseFollowFromUser()
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
      props.highContrastPath,
    ] as const,
  () => {
    if (!map?.isStyleLoaded()) return
    ensureLayers()
    syncData()
  },
  { deep: true },
)

onBeforeUnmount(() => {
  if (resumeFollowTimer) clearTimeout(resumeFollowTimer)
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
  border-radius: 0;
  overflow: hidden;
  border: none;
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
