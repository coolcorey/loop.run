<script setup lang="ts">
import RouteMap from '@/components/RouteMap.vue'
import { useGuestStore } from '@/stores/guest'
import { useRunsStore } from '@/stores/runs'
import { formatDistance, formatDuration, formatPace, fromMeters } from '@/services/geo'
import { SPEED_LEGEND } from '@/services/speedColor'
import type { RunLog } from '@/types'

const guest = useGuestStore()
const runs = useRunsStore()

function distFor(run: RunLog) {
  return Math.max(run.alongRouteMeters || 0, run.distanceMeters)
}

function paceFor(run: RunLog) {
  const d = fromMeters(distFor(run), guest.unit)
  if (d <= 0) return 0
  return run.durationSeconds / d
}

function trailFor(run: RunLog) {
  return run.trailSnapshot?.length ? run.trailSnapshot : run.samples
}

function pathFor(run: RunLog) {
  if (!run.routeId) return trailFor(run)
  const r = runs.routes.find((x) => x.id === run.routeId)
  return r?.path?.length ? r.path : trailFor(run)
}
</script>

<template>
  <section>
    <p class="lede" style="margin-top: 0">Runs on this device.</p>

    <div v-if="runs.history.length" class="stack">
      <div
        v-for="run in runs.history"
        :key="run.id"
        class="card"
        style="margin-bottom: 0"
      >
        <div class="row" style="justify-content: space-between">
          <strong>{{ run.routeSummary }}</strong>
          <span class="badge">
            {{ run.loopCompleted ? 'loop' : run.completed ? 'done' : 'partial' }}
          </span>
        </div>
        <div class="muted small">
          {{ new Date(run.startedAt).toLocaleString() }}
        </div>

        <RouteMap
          v-if="trailFor(run).length > 1 || pathFor(run).length > 1"
          style="margin-top: 0.65rem"
          height="180px"
          high-contrast-path
          mode="overview"
          :path="pathFor(run)"
          :trail="trailFor(run)"
          :interactive="false"
        />

        <div
          v-if="trailFor(run).length > 1"
          class="speed-legend"
          style="margin-top: 0.4rem"
        >
          <span
            v-for="s in SPEED_LEGEND"
            :key="s.label"
            class="speed-legend-stop"
          >
            <i :style="{ background: s.color }" />
            {{ s.label }}
          </span>
        </div>

        <div class="stat-grid" style="margin-top: 0.65rem">
          <div class="stat">
            <div class="stat-label">Distance</div>
            <div class="stat-value" style="font-size: 1rem">
              {{ formatDistance(distFor(run), guest.unit) }}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">Time</div>
            <div class="stat-value" style="font-size: 1rem">
              {{ formatDuration(run.durationSeconds) }}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">Pace</div>
            <div class="stat-value" style="font-size: 1rem">
              {{ formatPace(paceFor(run)) }}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">kcal</div>
            <div class="stat-value" style="font-size: 1rem">
              {{ run.estimatedCalories }}
            </div>
          </div>
        </div>
        <p v-if="run.splits?.length" class="muted small" style="margin: 0.5rem 0 0">
          Splits:
          <span v-for="s in run.splits" :key="s.index">
            {{ s.index }}={{ formatPace(s.paceSecondsPerUnit) }}
            <template v-if="s.index < run.splits.length"> · </template>
          </span>
        </p>
        <div v-if="run.debrief" class="muted small" style="margin: 0.65rem 0 0">
          <strong style="color: var(--text)">{{ run.debrief.headline }}</strong>
          <ul style="margin: 0.35rem 0 0; padding-left: 1.1rem">
            <li v-for="(b, i) in run.debrief.bullets" :key="i">{{ b }}</li>
          </ul>
        </div>
      </div>
    </div>
    <p v-else class="empty">No runs yet. Plan a loop and hit the pavement.</p>
  </section>
</template>
