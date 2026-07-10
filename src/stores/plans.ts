import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { TrainingPlan, TrainingSession } from '@/types'
import { loadJson, saveJson } from '@/services/storage'

const KEY = 'loop.plans'
const PROGRESS_KEY = 'loop.planProgress'

/** planId → next day number to run (1-based) */
type PlanProgress = Record<string, number>

export const usePlansStore = defineStore('plans', () => {
  const plans = ref<TrainingPlan[]>(loadJson(KEY, []))
  const activePlanId = ref<string | null>(
    loadJson<string | null>('loop.activePlanId', null),
  )
  const progress = ref<PlanProgress>(loadJson(PROGRESS_KEY, {}))

  watch(plans, (v) => saveJson(KEY, v), { deep: true })
  watch(activePlanId, (v) => saveJson('loop.activePlanId', v))
  watch(progress, (v) => saveJson(PROGRESS_KEY, v), { deep: true })

  const activePlan = computed(
    () => plans.value.find((p) => p.id === activePlanId.value) ?? plans.value[0] ?? null,
  )

  function nextDayFor(planId: string): number {
    return progress.value[planId] ?? 1
  }

  /**
   * Next incomplete non-rest session for the active (or given) plan.
   * Advances past rest days automatically for "today's workout".
   */
  function todaysSession(planId?: string | null): {
    plan: TrainingPlan
    session: TrainingSession
  } | null {
    const plan =
      (planId
        ? plans.value.find((p) => p.id === planId)
        : activePlan.value) ?? null
    if (!plan || !plan.sessions.length) return null

    let day = nextDayFor(plan.id)
    if (day > plan.days) return null

    // Skip rest days
    while (day <= plan.days) {
      const session =
        plan.sessions.find((s) => s.day === day) ??
        plan.sessions[day - 1]
      if (!session) {
        day++
        continue
      }
      if (session.isRest) {
        day++
        continue
      }
      // Persist skip of rest so we don't re-hit them
      if (day !== nextDayFor(plan.id)) {
        progress.value = { ...progress.value, [plan.id]: day }
      }
      return { plan, session }
    }
    return null
  }

  function markSessionComplete(planId: string, day: number) {
    const next = Math.max(nextDayFor(planId), day + 1)
    progress.value = { ...progress.value, [planId]: next }
  }

  function resetProgress(planId: string) {
    const next = { ...progress.value }
    delete next[planId]
    progress.value = next
  }

  function addPlan(plan: TrainingPlan) {
    plans.value = [plan, ...plans.value]
    activePlanId.value = plan.id
    progress.value = { ...progress.value, [plan.id]: 1 }
  }

  function removePlan(id: string) {
    plans.value = plans.value.filter((p) => p.id !== id)
    const next = { ...progress.value }
    delete next[id]
    progress.value = next
    if (activePlanId.value === id) {
      activePlanId.value = plans.value[0]?.id ?? null
    }
  }

  function setActive(id: string | null) {
    activePlanId.value = id
  }

  return {
    plans,
    activePlanId,
    activePlan,
    progress,
    nextDayFor,
    todaysSession,
    markSessionComplete,
    resetProgress,
    addPlan,
    removePlan,
    setActive,
  }
})
