<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useGuestStore } from '@/stores/guest'
import { useRunsStore } from '@/stores/runs'
import { usePlansStore } from '@/stores/plans'
import { useFavoritesStore } from '@/stores/favorites'
import { formatDistance, formatDuration, formatPace } from '@/services/geo'
import { startSessionRun } from '@/services/session'

const guest = useGuestStore()
const runs = useRunsStore()
const plans = usePlansStore()
const favorites = useFavoritesStore()
const router = useRouter()

runs.sanitizeActiveRun()

const lastRun = computed(() => runs.history[0] ?? null)
const activePlan = computed(() => plans.activePlan)
const resume = computed(() => runs.resumableSummary)
const today = computed(() => plans.todaysSession())
const starting = ref(false)
const sessionError = ref<string | null>(null)

async function startToday() {
  const t = today.value
  if (!t) return
  sessionError.value = null
  starting.value = true
  try {
    await startSessionRun({
      planId: t.plan.id,
      session: t.session,
      unit: guest.unit,
    })
    router.push({ name: 'run' })
  } catch (e) {
    sessionError.value = e instanceof Error ? e.message : 'Could not start session'
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <section>
    <h1>Ready when you are.</h1>
    <p class="lede">
      Plan a loop, run on-route with splits and voice coach, or start today’s training session.
    </p>

    <div class="stack">
      <button
        v-if="today"
        class="btn btn-primary btn-block"
        type="button"
        :disabled="starting"
        @click="startToday"
      >
        {{ starting ? 'Planning session…' : `Start: ${today.session.title}` }}
      </button>
      <RouterLink class="btn" :class="today ? 'btn-ghost' : 'btn-primary'" style="display: flex; width: 100%; box-sizing: border-box" to="/plan">
        Plan a loop
      </RouterLink>
      <RouterLink
        class="btn btn-ghost btn-block"
        :to="runs.hasResumableRun ? { name: 'run', query: { resume: '1' } } : '/run'"
      >
        <template v-if="runs.hasResumableRun && resume">
          Resume run
          <span class="muted" style="font-weight: 500">
            · {{ resume.summary }}
            · {{ formatDistance(resume.distanceMeters, guest.unit) }}
          </span>
        </template>
        <template v-else>Open run mode</template>
      </RouterLink>
    </div>
    <p v-if="sessionError" class="error">{{ sessionError }}</p>

    <div v-if="today" class="card" style="margin-top: 1.25rem">
      <div class="card-title">Today’s workout</div>
      <strong>{{ today.session.title }}</strong>
      <p class="muted small" style="margin: 0.35rem 0 0">
        {{ today.plan.title }} · day {{ today.session.day }}
      </p>
      <p v-if="today.session.distanceMeters" class="muted small">
        ~{{ formatDistance(today.session.distanceMeters, guest.unit) }}
        <template v-if="today.session.targetPaceSecondsPerUnit">
          · {{ formatPace(today.session.targetPaceSecondsPerUnit) }}/{{ guest.unit }}
        </template>
      </p>
    </div>

    <div class="card" :style="today ? undefined : { marginTop: '1.25rem' }">
      <div class="card-title">Favorites</div>
      <template v-if="favorites.count">
        <p class="small" style="margin: 0">
          {{ favorites.count }} saved route{{ favorites.count === 1 ? '' : 's' }}.
          <RouterLink to="/plan">Open on Plan</RouterLink>
        </p>
      </template>
      <p v-else class="muted small" style="margin: 0">
        No favorites yet. Plan a loop and tap <strong>Save favorite</strong>.
      </p>
    </div>

    <div class="card">
      <div class="card-title">Active plan</div>
      <template v-if="activePlan">
        <strong>{{ activePlan.title }}</strong>
        <p class="muted small" style="margin: 0.35rem 0 0">
          Next day {{ plans.nextDayFor(activePlan.id) }}
          · {{ activePlan.sessions.length }} sessions
        </p>
      </template>
      <p v-else class="muted small" style="margin: 0">
        No plan yet.
        <RouterLink to="/plans">Build one</RouterLink>
      </p>
    </div>

    <div class="card">
      <div class="card-title">Last run</div>
      <template v-if="lastRun">
        <strong>{{ lastRun.routeSummary }}</strong>
        <div class="stat-grid" style="margin-top: 0.65rem">
          <div class="stat">
            <div class="stat-label">Distance</div>
            <div class="stat-value">
              {{ formatDistance(Math.max(lastRun.alongRouteMeters || 0, lastRun.distanceMeters), guest.unit) }}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">Time</div>
            <div class="stat-value">{{ formatDuration(lastRun.durationSeconds) }}</div>
          </div>
        </div>
        <p v-if="lastRun.loopCompleted" class="success small" style="margin: 0.5rem 0 0">Loop completed</p>
        <p v-if="lastRun.splits?.length" class="muted small" style="margin: 0.25rem 0 0">
          {{ lastRun.splits.length }} splits
        </p>
      </template>
      <p v-else class="muted small" style="margin: 0">No runs logged yet.</p>
    </div>

    <p class="muted small">
      Units: <strong>{{ guest.unit }}</strong>
      · Turn cues at ~{{ guest.profile.turnAnnounceMeters }}m
      · <RouterLink to="/settings">Settings</RouterLink>
    </p>
  </section>
</template>
