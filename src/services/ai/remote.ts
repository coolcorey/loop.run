import type { AiProvider, GeneratePlanInput, PlanRouteInput } from './types'
import type { CoachContext, CoachNudge, PlannedRoute, TrainingPlan } from '@/types'
import { apiFetch } from '@/services/api'
import { mockAi } from './mock'

/**
 * Talks to local Loop API (xAI + road routing).
 * Falls back to mock for individual calls if the API is down / no key.
 */
export const remoteAi: AiProvider = {
  name: 'xai',

  async planRoute(input: PlanRouteInput): Promise<PlannedRoute> {
    try {
      const route = await apiFetch<PlannedRoute & { provider?: string }>(
        '/api/route/loop',
        {
          method: 'POST',
          body: JSON.stringify({
            origin: input.origin,
            goalKind: input.goalKind,
            targetValue: input.targetValue,
            unit: input.unit,
            weightKg: input.weightKg,
            turnAnnounceMeters: input.turnAnnounceMeters,
            preferences: input.preferences,
            startBearing: input.startBearing,
            regenerate: input.regenerate,
          }),
        },
      )
      return {
        id: route.id,
        summary: route.summary,
        goalKind: route.goalKind,
        targetValue: route.targetValue,
        unit: route.unit,
        distanceMeters: route.distanceMeters,
        estimatedCalories: route.estimatedCalories,
        path: route.path,
        turns: route.turns,
        createdAt: route.createdAt,
        aiNotes: route.aiNotes,
      }
    } catch (e) {
      console.warn('[ai] planRoute remote failed, using mock', e)
      return mockAi.planRoute(input)
    }
  },

  async generateTrainingPlan(input: GeneratePlanInput): Promise<TrainingPlan> {
    try {
      return await apiFetch<TrainingPlan>('/api/ai/training-plan', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    } catch (e) {
      const err = e as Error & { code?: string }
      if (err.code === 'NO_XAI') {
        console.warn('[ai] no XAI key, mock plan')
        return mockAi.generateTrainingPlan(input)
      }
      console.warn('[ai] training plan remote failed, using mock', e)
      return mockAi.generateTrainingPlan(input)
    }
  },

  async coachNudge(ctx: CoachContext): Promise<CoachNudge> {
    try {
      return await apiFetch<CoachNudge>('/api/ai/coach-nudge', {
        method: 'POST',
        body: JSON.stringify(ctx),
      })
    } catch {
      return mockAi.coachNudge(ctx)
    }
  },
}
