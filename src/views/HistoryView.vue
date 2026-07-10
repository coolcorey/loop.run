<script setup lang="ts">
import { useGuestStore } from '@/stores/guest'
import { useRunsStore } from '@/stores/runs'
import { formatDistance, formatDuration, formatPace, fromMeters } from '@/services/geo'
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
</script>

<template>
  <section>
    <h1>History</h1>
    <p class="lede">Runs saved on this device (guest mode).</p>

    <div v-if="runs.history.length" class="card">
      <div
        v-for="run in runs.history"
        :key="run.id"
        class="list-item"
        style="flex-direction: column; align-items: stretch"
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
        <div class="stat-grid" style="margin-top: 0.5rem">
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
        <p v-if="run.nudges?.length" class="muted small" style="margin: 0.25rem 0 0">
          {{ run.nudges.length }} coach nudges
        </p>
      </div>
    </div>
    <p v-else class="empty">No runs yet. Plan a loop and hit the pavement.</p>
  </section>
</template>
