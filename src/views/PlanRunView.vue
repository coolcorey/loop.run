<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import RouteMap from '@/components/RouteMap.vue'
import { ai } from '@/services/ai'
import {
  FALLBACK_ORIGIN,
  formatDistance,
  GeoError,
  getCurrentPosition,
  isSecureGeoContext,
} from '@/services/geo'
import { useFavoritesStore } from '@/stores/favorites'
import { useGuestStore } from '@/stores/guest'
import { useRunsStore } from '@/stores/runs'
import type { GeoPoint, PlannedRoute, RouteGoalKind } from '@/types'

const guest = useGuestStore()
const runs = useRunsStore()
const favorites = useFavoritesStore()
const router = useRouter()

const goalKind = ref<RouteGoalKind>('distance')
const targetValue = ref(3)
const preferences = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const success = ref<string | null>(null)
const route = ref<PlannedRoute | null>(null)
const locating = ref(false)
const originPoint = ref<GeoPoint | null>(null)
const locationOk = ref(false)
const locationHint = ref<string | null>(
  isSecureGeoContext()
    ? null
    : 'This page is not a secure context — GPS is blocked. Use https://… or http://localhost (not http://192.168.x.x).',
)
/** Last bearing used so “different route” can pivot away from it */
const lastBearing = ref<number | null>(null)

const isSaved = computed(() =>
  route.value ? favorites.isFavorite(route.value.id) : false,
)

async function acquireOrigin(force = false): Promise<GeoPoint> {
  if (!force && originPoint.value && locationOk.value) {
    return originPoint.value
  }
  locating.value = true
  locationHint.value = null
  try {
    const origin = await getCurrentPosition({
      maxWaitMs: 12_000,
      forceFresh: force,
    })
    originPoint.value = origin
    locationOk.value = true
    return origin
  } catch (e) {
    locationOk.value = false
    const msg =
      e instanceof GeoError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Location failed'
    locationHint.value = msg
    if (originPoint.value) {
      locationHint.value = `${msg} Using last known start.`
      return originPoint.value
    }
    throw e
  } finally {
    locating.value = false
  }
}

/** Quiet background fix so Plan can show GPS status without a button */
async function warmLocation() {
  if (!isSecureGeoContext()) return
  locating.value = true
  try {
    const origin = await getCurrentPosition({
      maxWaitMs: 12_000,
      forceFresh: false,
    })
    originPoint.value = origin
    locationOk.value = true
    locationHint.value = null
  } catch {
    // Leave subtle "waiting" state; plan() will retry / fall back
    locationOk.value = false
  } finally {
    locating.value = false
  }
}

onMounted(() => {
  void warmLocation()
})

function nextBearing(regenerate: boolean): number {
  if (!regenerate || lastBearing.value == null) {
    return Math.floor(Math.random() * 360)
  }
  // Swing ~60–140° so the road loop is visibly different
  const delta = 60 + Math.floor(Math.random() * 80)
  const sign = Math.random() < 0.5 ? -1 : 1
  return (((lastBearing.value + sign * delta) % 360) + 360) % 360
}

async function plan(opts: { regenerate?: boolean } = {}) {
  const regenerate = Boolean(opts.regenerate)
  error.value = null
  success.value = null
  loading.value = true
  // Keep current map visible while regenerating
  if (!regenerate) {
    route.value = null
  }

  try {
    let origin: GeoPoint
    if (regenerate && originPoint.value && locationOk.value) {
      origin = originPoint.value
    } else {
      try {
        origin = await acquireOrigin(!regenerate)
      } catch (e) {
        const detail =
          e instanceof Error
            ? e.message
            : 'GPS unavailable — using a placeholder start.'
        error.value = `${detail} Planning a demo loop from a placeholder location.`
        origin = FALLBACK_ORIGIN
        originPoint.value = origin
        locationOk.value = false
      }
    }

    const bearing = nextBearing(regenerate)
    lastBearing.value = bearing

    const planned = await ai.planRoute({
      origin,
      goalKind: goalKind.value,
      targetValue: Number(targetValue.value),
      unit: guest.unit,
      weightKg: guest.profile.weightKg,
      turnAnnounceMeters: guest.profile.turnAnnounceMeters,
      preferences: preferences.value || undefined,
      startBearing: bearing,
      regenerate,
    })
    route.value = planned
    runs.saveRoute(planned)
    if (regenerate) {
      success.value = 'New route generated.'
    }
    // Wait for the planned card to render, then bring it into view
    await nextTick()
    document
      .getElementById('planned-route')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not plan route'
  } finally {
    loading.value = false
  }
}

function saveFavorite() {
  if (!route.value) return
  favorites.addFavorite(route.value)
  success.value = 'Saved to favorites.'
  error.value = null
}

function unsaveFavorite() {
  if (!route.value) return
  favorites.removeFavorite(route.value.id)
  success.value = 'Removed from favorites.'
}

function loadFavorite(fav: PlannedRoute) {
  route.value = fav
  runs.setActiveRoute(fav)
  originPoint.value = fav.path[0] ?? originPoint.value
  success.value = null
  error.value = null
  // scroll to planned card
  document.getElementById('planned-route')?.scrollIntoView({ behavior: 'smooth' })
}

function startRun() {
  if (!route.value) return
  runs.startRun(route.value)
  router.push({ name: 'run' })
}

function startFavorite(fav: PlannedRoute) {
  runs.startRun(fav)
  router.push({ name: 'run' })
}
</script>

<template>
  <section>
    <h1>Plan a loop</h1>
    <p class="lede">
      Closed path on real roads back to where you start. Generate another if you
      don’t like it, or save keepers to favorites.
    </p>

    <div class="card stack">
      <div class="row">
        <span class="muted small">Goal</span>
        <div class="seg">
          <button
            type="button"
            :class="{ active: goalKind === 'distance' }"
            @click="goalKind = 'distance'"
          >
            Distance
          </button>
          <button
            type="button"
            :class="{ active: goalKind === 'calories' }"
            @click="goalKind = 'calories'"
          >
            Calories
          </button>
        </div>
      </div>

      <div class="field">
        <label v-if="goalKind === 'distance'">
          Distance ({{ guest.unit }})
        </label>
        <label v-else>Calories to burn (est.)</label>
        <input
          v-model.number="targetValue"
          type="number"
          min="0.1"
          step="0.1"
          :placeholder="goalKind === 'distance' ? '3' : '300'"
        />
      </div>

      <div class="field">
        <label>Preferences (optional)</label>
        <textarea
          v-model="preferences"
          rows="2"
          placeholder="e.g. flatter, parks, avoid highways"
        />
      </div>

      <button
        class="btn btn-primary btn-block"
        type="button"
        :disabled="loading"
        @click="plan()"
      >
        {{ loading && !route ? (locating ? 'Getting location…' : 'Planning…') : 'Plan route' }}
      </button>

      <p class="gps-status small" :class="locationOk ? 'success' : 'muted'">
        <template v-if="locationOk && originPoint">
          <span class="gps-dot ok" aria-hidden="true" />
          Location ready
          <template v-if="originPoint.accuracy != null">
            · ±{{ Math.round(originPoint.accuracy) }}m
          </template>
        </template>
        <template v-else-if="locating">
          <span class="gps-dot pulse" aria-hidden="true" />
          Finding location…
        </template>
        <template v-else>
          <span class="gps-dot" aria-hidden="true" />
          Location pending — will request when you plan
        </template>
      </p>
    </div>

    <p v-if="locationHint && !locationOk" class="error small">{{ locationHint }}</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="success" class="success">{{ success }}</p>

    <div v-if="route" id="planned-route" class="card">
      <div class="row" style="justify-content: space-between; align-items: flex-start">
        <div>
          <div class="card-title">Planned</div>
          <strong>{{ route.summary }}</strong>
        </div>
        <span v-if="isSaved" class="badge">favorite</span>
      </div>
      <RouteMap
        style="margin-top: 0.75rem"
        height="240px"
        :path="route.path"
        :user="originPoint"
      />
      <div class="stat-grid" style="margin-top: 0.75rem">
        <div class="stat">
          <div class="stat-label">Distance</div>
          <div class="stat-value">
            {{ formatDistance(route.distanceMeters, guest.unit) }}
          </div>
        </div>
        <div class="stat">
          <div class="stat-label">Est. kcal</div>
          <div class="stat-value">{{ route.estimatedCalories }}</div>
        </div>
      </div>
      <p class="muted small" style="margin-top: 0.75rem">{{ route.aiNotes }}</p>
      <p class="muted small">
        {{ route.turns.length }} turn cues · announce ~{{ guest.profile.turnAnnounceMeters }}m out
      </p>
      <div v-if="route.turns.length" class="turn-list">
        <div
          v-for="(t, i) in route.turns.slice(0, 8)"
          :key="t.id"
          class="turn-row small"
        >
          <span class="muted">{{ i + 1 }}.</span> {{ t.instruction }}
        </div>
        <p v-if="route.turns.length > 8" class="muted small">
          +{{ route.turns.length - 8 }} more turns
        </p>
      </div>

      <div class="stack" style="margin-top: 0.85rem">
        <button class="btn btn-primary btn-block" type="button" @click="startRun">
          Start run
        </button>
        <div class="row" style="gap: 0.5rem">
          <button
            class="btn btn-ghost"
            type="button"
            style="flex: 1"
            :disabled="loading"
            @click="plan({ regenerate: true })"
          >
            {{ loading ? 'Generating…' : 'Different route' }}
          </button>
          <button
            v-if="!isSaved"
            class="btn btn-ghost"
            type="button"
            style="flex: 1"
            @click="saveFavorite"
          >
            Save favorite
          </button>
          <button
            v-else
            class="btn btn-ghost"
            type="button"
            style="flex: 1"
            @click="unsaveFavorite"
          >
            Unsave
          </button>
        </div>
        <RouterLink class="btn btn-ghost btn-block" to="/run">Open run mode</RouterLink>
      </div>
    </div>

    <div v-if="favorites.favorites.length" class="card">
      <div class="card-title">Favorites</div>
      <div
        v-for="fav in favorites.favorites"
        :key="fav.id"
        class="list-item"
        style="flex-direction: column; align-items: stretch; gap: 0.45rem"
      >
        <div class="row" style="justify-content: space-between">
          <div>
            <strong>{{ fav.favoriteName || fav.summary }}</strong>
            <div class="muted small">
              {{ formatDistance(fav.distanceMeters, guest.unit) }}
              · ~{{ fav.estimatedCalories }} kcal
            </div>
          </div>
          <span class="badge">{{ fav.unit }}</span>
        </div>
        <div class="row">
          <button
            class="btn btn-ghost"
            type="button"
            style="flex: 1; padding: 0.45rem; font-size: 0.85rem"
            @click="loadFavorite(fav)"
          >
            View
          </button>
          <button
            class="btn btn-primary"
            type="button"
            style="flex: 1; padding: 0.45rem; font-size: 0.85rem"
            @click="startFavorite(fav)"
          >
            Run
          </button>
          <button
            class="btn btn-danger"
            type="button"
            style="padding: 0.45rem 0.65rem; font-size: 0.85rem"
            @click="favorites.removeFavorite(fav.id)"
          >
            Del
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
