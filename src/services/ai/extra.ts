import { apiFetch } from '@/services/api'
import type { RunDebrief, RunLog, TrainingSession } from '@/types'

export async function fetchDebrief(input: {
  run: RunLog
  unit: 'mi' | 'km'
  athleteNotes?: string
}): Promise<RunDebrief | null> {
  try {
    const d = await apiFetch<RunDebrief>('/api/ai/debrief', {
      method: 'POST',
      body: JSON.stringify({
        routeSummary: input.run.routeSummary,
        distanceMeters: Math.max(
          input.run.alongRouteMeters || 0,
          input.run.distanceMeters,
        ),
        durationSeconds: input.run.durationSeconds,
        alongRouteMeters: input.run.alongRouteMeters,
        loopCompleted: input.run.loopCompleted,
        splits: input.run.splits,
        targetSpeedMps: input.run.targetSpeedMps,
        unit: input.unit,
        athleteNotes: input.athleteNotes || undefined,
        freeRun: input.run.routeId == null,
      }),
    })
    return d
  } catch {
    return null
  }
}

export async function fetchSessionBrief(input: {
  session: TrainingSession
  planTitle?: string
  unit: 'mi' | 'km'
  athleteNotes?: string
}): Promise<{ speak: string; card: string } | null> {
  try {
    return await apiFetch('/api/ai/session-brief', {
      method: 'POST',
      body: JSON.stringify({
        sessionTitle: input.session.title,
        description: input.session.description,
        distanceMeters: input.session.distanceMeters,
        targetPaceSecondsPerUnit: input.session.targetPaceSecondsPerUnit,
        unit: input.unit,
        athleteNotes: input.athleteNotes || undefined,
        planTitle: input.planTitle,
      }),
    })
  } catch {
    return null
  }
}

/** Local split line — no network, works offline */
export function localSplitCommentary(input: {
  splitIndex: number
  paceSecondsPerUnit: number
  targetPaceSecondsPerUnit?: number | null
  unit: 'mi' | 'km'
}): string {
  const pace = input.paceSecondsPerUnit
  const target = input.targetPaceSecondsPerUnit
  if (target && target > 0) {
    const delta = pace - target
    if (delta > 12) {
      return `Split ${input.splitIndex}. A bit slow of target — settle in.`
    }
    if (delta < -12) {
      return `Split ${input.splitIndex}. Hot vs target — ease a touch.`
    }
    return `Split ${input.splitIndex}. Right on target. Hold.`
  }
  return `Split ${input.splitIndex}. Keep it honest.`
}

export function localMilestoneLine(pct: number): string {
  if (pct <= 0.3) return 'Quarter done. Smooth and steady.'
  if (pct <= 0.55) return 'Halfway. Stay tall.'
  return 'Three quarters. Finish strong.'
}
