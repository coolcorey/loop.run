<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ai } from '@/services/ai'
import { formatDistance, formatPace } from '@/services/geo'
import { startSessionRun } from '@/services/session'
import { useGuestStore } from '@/stores/guest'
import { usePlansStore } from '@/stores/plans'
import type { TrainingGoalKind } from '@/types'

const guest = useGuestStore()
const plans = usePlansStore()
const router = useRouter()

const goalKind = ref<TrainingGoalKind>('race_time')
const raceId = ref('5k')
const targetLabel = ref('5k')
const targetMinutes = ref(28)
const days = ref(28)
const caloriesPerRun = ref(400)
const notes = ref('')
const loading = ref(false)
const starting = ref(false)
const error = ref<string | null>(null)

const expandedId = ref<string | null>(null)

const goalOptions: { value: TrainingGoalKind; label: string }[] = [
  { value: 'race_time', label: 'Race finish time' },
  { value: 'distance_time', label: 'Distance in time' },
  { value: 'calories_per_run', label: 'Calories per run' },
]

/**
 * Common race / distance goals with solid intermediate defaults
 * (finish time minutes + plan length). User can edit after picking.
 */
const racePresets: {
  id: string
  label: string
  /** default finish time (minutes) for a solid recreational goal */
  defaultMinutes: number
  /** suggested plan length */
  defaultDays: number
}[] = [
  { id: '1mi', label: '1 mile', defaultMinutes: 8, defaultDays: 21 },
  { id: '5k', label: '5K', defaultMinutes: 28, defaultDays: 28 },
  { id: '8k', label: '8K', defaultMinutes: 45, defaultDays: 35 },
  { id: '10k', label: '10K', defaultMinutes: 55, defaultDays: 42 },
  { id: '15k', label: '15K', defaultMinutes: 85, defaultDays: 49 },
  { id: '10mi', label: '10 mile', defaultMinutes: 95, defaultDays: 49 },
  { id: 'half', label: 'Half marathon', defaultMinutes: 120, defaultDays: 70 },
  { id: '30k', label: '30K', defaultMinutes: 180, defaultDays: 77 },
  { id: 'marathon', label: 'Marathon', defaultMinutes: 255, defaultDays: 112 },
  { id: '50k', label: '50K ultra', defaultMinutes: 360, defaultDays: 126 },
  { id: '50mi', label: '50 mile', defaultMinutes: 600, defaultDays: 140 },
  { id: '100k', label: '100K ultra', defaultMinutes: 840, defaultDays: 154 },
  { id: '100mi', label: '100 mile', defaultMinutes: 1440, defaultDays: 168 },
  { id: 'custom', label: 'Custom…', defaultMinutes: 30, defaultDays: 28 },
]

const showRacePresets = computed(
  () => goalKind.value === 'race_time' || goalKind.value === 'distance_time',
)

const isCustomRace = computed(() => raceId.value === 'custom')

function applyRacePreset(id: string) {
  raceId.value = id
  const p = racePresets.find((r) => r.id === id)
  if (!p) return
  if (id !== 'custom') {
    targetLabel.value = p.label
    targetMinutes.value = p.defaultMinutes
    days.value = Math.min(180, p.defaultDays)
  }
}

function onGoalKindChange() {
  if (goalKind.value === 'calories_per_run') return
  if (!raceId.value) raceId.value = '5k'
  applyRacePreset(raceId.value)
}

const today = computed(() => plans.todaysSession())

async function generate() {
  error.value = null
  loading.value = true
  try {
    const plan = await ai.generateTrainingPlan({
      goalKind: goalKind.value,
      targetLabel: targetLabel.value,
      targetTimeSeconds:
        goalKind.value === 'calories_per_run'
          ? undefined
          : Math.round(targetMinutes.value * 60),
      days: Math.max(3, Math.min(180, days.value)),
      caloriesPerRun:
        goalKind.value === 'calories_per_run' ? caloriesPerRun.value : undefined,
      unit: guest.unit,
      notes:
        [
          notes.value || null,
          guest.profile.athleteNotes?.trim() || null,
          showRacePresets.value && raceId.value !== 'custom'
            ? `Race distance preset: ${targetLabel.value}`
            : null,
        ]
          .filter(Boolean)
          .join('. ') || undefined,
    })
    plans.addPlan(plan)
    expandedId.value = plan.id
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not generate plan'
  } finally {
    loading.value = false
  }
}

async function startToday() {
  const t = today.value
  if (!t) return
  error.value = null
  starting.value = true
  try {
    await startSessionRun({
      planId: t.plan.id,
      session: t.session,
      unit: guest.unit,
    })
    router.push({ name: 'run' })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not start session'
  } finally {
    starting.value = false
  }
}

const sorted = computed(() => plans.plans)
</script>

<template>
  <section>
    <p class="lede" style="margin-top: 0">
      Build a training plan, then start today’s session — Loop routes a loop and sets target pace.
    </p>

    <div v-if="today" class="card stack">
      <div class="card-title">Today’s session</div>
      <strong>{{ today.plan.title }}</strong>
      <p class="small" style="margin: 0.35rem 0">
        Day {{ today.session.day }} — {{ today.session.title }}
      </p>
      <p class="muted small" style="margin: 0">{{ today.session.description }}</p>
      <p v-if="today.session.distanceMeters" class="muted small">
        ~{{ formatDistance(today.session.distanceMeters, guest.unit) }}
        <template v-if="today.session.targetPaceSecondsPerUnit">
          · target {{ formatPace(today.session.targetPaceSecondsPerUnit) }}/{{ guest.unit }}
        </template>
      </p>
      <button
        class="btn btn-primary btn-block"
        type="button"
        :disabled="starting"
        @click="startToday"
      >
        {{ starting ? 'Planning loop…' : 'Start today’s session' }}
      </button>
    </div>
    <div v-else-if="plans.activePlan" class="card">
      <p class="muted small" style="margin: 0">
        Plan complete (or only rest days left).
        <button class="btn btn-ghost" type="button" style="margin-left: 0.35rem; padding: 0.2rem 0.5rem; font-size: 0.8rem" @click="plans.resetProgress(plans.activePlan!.id)">
          Reset progress
        </button>
      </p>
    </div>

    <div class="card stack">
      <div class="field">
        <label>Goal type</label>
        <select v-model="goalKind" @change="onGoalKindChange">
          <option v-for="o in goalOptions" :key="o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
      </div>

      <div v-if="showRacePresets" class="field">
        <label>Distance / race</label>
        <select v-model="raceId" @change="applyRacePreset(raceId)">
          <option v-for="r in racePresets" :key="r.id" :value="r.id">
            {{ r.label }}
          </option>
        </select>
        <span class="muted small">
          From 1 mile through 100 milers. Defaults are intermediate recreational goals — tweak time and days below.
        </span>
      </div>

      <div v-if="showRacePresets && isCustomRace" class="field">
        <label>Custom distance label</label>
        <input v-model="targetLabel" type="text" placeholder="e.g. 12K trail, stadium stairs" />
      </div>

      <div v-if="goalKind !== 'calories_per_run'" class="field">
        <label>Target finish time (minutes)</label>
        <input v-model.number="targetMinutes" type="number" min="5" step="1" />
        <span v-if="targetMinutes >= 60" class="muted small">
          ≈ {{ Math.floor(targetMinutes / 60) }}h {{ targetMinutes % 60 }}m
        </span>
      </div>

      <div v-else class="field">
        <label>Calories per run</label>
        <input v-model.number="caloriesPerRun" type="number" min="50" step="10" />
      </div>

      <div class="field">
        <label>Days until goal</label>
        <input v-model.number="days" type="number" min="3" max="180" />
        <span class="muted small">Up to 180 days for longer races.</span>
      </div>

      <div class="field">
        <label>Notes</label>
        <textarea v-model="notes" rows="2" placeholder="Injured ankle, prefer mornings…" />
      </div>

      <button class="btn btn-primary btn-block" type="button" :disabled="loading" @click="generate">
        {{ loading ? 'Generating…' : 'Generate plan' }}
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="sorted.length" class="card">
      <div class="card-title">Your training</div>
      <div
        v-for="plan in sorted"
        :key="plan.id"
        class="list-item"
        style="flex-direction: column; align-items: stretch"
      >
        <div class="row" style="justify-content: space-between">
          <div>
            <strong>{{ plan.title }}</strong>
            <div class="muted small">
              {{ plan.sessions.length }} sessions
              · next day {{ plans.nextDayFor(plan.id) }}
            </div>
          </div>
          <div class="row">
            <button
              class="btn btn-ghost"
              type="button"
              style="padding: 0.35rem 0.6rem; font-size: 0.8rem"
              @click="plans.setActive(plan.id)"
            >
              {{ plans.activePlanId === plan.id ? 'Active' : 'Set active' }}
            </button>
            <button
              class="btn btn-ghost"
              type="button"
              style="padding: 0.35rem 0.6rem; font-size: 0.8rem"
              @click="expandedId = expandedId === plan.id ? null : plan.id"
            >
              {{ expandedId === plan.id ? 'Hide' : 'View' }}
            </button>
            <button
              class="btn btn-danger"
              type="button"
              style="padding: 0.35rem 0.6rem; font-size: 0.8rem"
              @click="plans.removePlan(plan.id)"
            >
              Del
            </button>
          </div>
        </div>

        <div v-if="expandedId === plan.id" class="stack" style="margin-top: 0.5rem">
          <p v-if="plan.notes" class="muted small">{{ plan.notes }}</p>
          <div
            v-for="s in plan.sessions.slice(0, 14)"
            :key="`${plan.id}-${s.day}`"
            class="small"
            style="padding: 0.4rem 0; border-top: 1px solid var(--border)"
            :style="s.day < plans.nextDayFor(plan.id) ? { opacity: 0.55 } : undefined"
          >
            <strong>
              Day {{ s.day }} — {{ s.title }}
              <span v-if="s.day < plans.nextDayFor(plan.id)" class="badge">done</span>
              <span v-else-if="s.day === plans.nextDayFor(plan.id)" class="badge">next</span>
            </strong>
            <div class="muted">{{ s.description }}</div>
            <div v-if="s.distanceMeters" class="muted">
              ~{{ formatDistance(s.distanceMeters, guest.unit) }}
              <template v-if="s.targetPaceSecondsPerUnit">
                · {{ formatPace(s.targetPaceSecondsPerUnit) }}/{{ guest.unit }}
              </template>
            </div>
          </div>
          <p v-if="plan.sessions.length > 14" class="muted small">
            +{{ plan.sessions.length - 14 }} more days…
          </p>
        </div>
      </div>
    </div>
    <p v-else class="empty">No training plans yet. Generate one above.</p>
  </section>
</template>
