import { apiFetch } from '@/services/api'
import type { RunDebrief, RunLog, TrainingSession } from '@/types'

export async function fetchDebrief(input: {
  run: RunLog
  unit: 'mi' | 'km'
  athleteNotes?: string
  voiceMode?: string
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
        voiceMode: input.voiceMode || 'coach',
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

import {
  localMilestoneLine as voiceMilestone,
  localSplitLine,
} from '@/services/coachVoices'
import type { CoachVoiceMode } from '@/types'

/** Local split line — no network, works offline */
export function localSplitCommentary(input: {
  splitIndex: number
  paceSecondsPerUnit: number
  targetPaceSecondsPerUnit?: number | null
  unit: 'mi' | 'km'
  voiceMode?: CoachVoiceMode
}): string {
  const pace = input.paceSecondsPerUnit
  const target = input.targetPaceSecondsPerUnit
  let vs: 'slow' | 'fast' | 'on' | 'none' = 'none'
  if (target && target > 0) {
    const delta = pace - target
    if (delta > 12) vs = 'slow'
    else if (delta < -12) vs = 'fast'
    else vs = 'on'
  }
  return localSplitLine(input.voiceMode || 'coach', input.splitIndex, vs)
}

export function localMilestoneLine(
  pct: number,
  voiceMode: CoachVoiceMode = 'coach',
): string {
  return voiceMilestone(voiceMode, pct)
}
