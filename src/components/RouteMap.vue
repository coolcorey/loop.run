<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl, { type GeoJSONSource, type Map as MaplibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { GeoPoint } from '@/types'

const props = withDefaults(
  defineProps<{
    path?: GeoPoint[]
    user?: GeoPoint | null
    height?: string
    interactive?: boolean
  }>(),
  {
    path: () => [],
    user: null,
    height: '220px',
    interactive: true,
  },
)

const el = ref<HTMLDivElement | null>(null)
let map: MaplibreMap | null = null

/** Dark basemap to match Loop UI. Override with VITE_MAP_STYLE. */
const STYLE =
  (import.meta.env.VITE_MAP_STYLE as string | undefined) ||
  'https://tiles.openfreemap.org/styles/dark'

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

function userGeoJson(user: GeoPoint | null) {
  return {
    type: 'FeatureCollection' as const,
    features: user
      ? [
          {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'Point' as const,
              coordinates: [user.lng, user.lat],
            },
          },
        ]
      : [],
  }
}

function ensureLayers() {
  if (!map) return

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
      data: userGeoJson(props.user),
    })
    map.addLayer({
      id: 'user-dot',
      type: 'circle',
      source: 'user',
      paint: {
        'circle-radius': 7,
        'circle-color': '#ff8a5b',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#0f1419',
      },
    })
  }
}

function syncData() {
  if (!map) return
  const route = map.getSource('route') as GeoJSONSource | undefined
  const user = map.getSource('user') as GeoJSONSource | undefined
  route?.setData(pathGeoJson(props.path))
  user?.setData(userGeoJson(props.user))

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
    zoom: 13,
    attributionControl: { compact: true },
    interactive: props.interactive,
  })

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

  map.on('load', () => {
    ensureLayers()
    syncData()
  })
})

watch(
  () => [props.path, props.user] as const,
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
