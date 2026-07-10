/** Shared domain types for Loop */

export type DistanceUnit = 'mi' | 'km'

export type RouteGoalKind = 'distance' | 'calories'

export interface GeoPoint {
  lat: number
  lng: number
  /** meters above sea level, if known */
  altitude?: number
  /** Unix ms */
  timestamp?: number
  /** m/s, if known */
  speed?: number
  /** degrees from north, if known */
  heading?: number
  accuracy?: number
}

export interface PlannedRoute {
  id: string
  /** Human label from planner / AI */
  summary: string
  goalKind: RouteGoalKind
  /** Requested target in the unit below */
  targetValue: number
  unit: DistanceUnit
  /** Estimated distance in meters */
  distanceMeters: number
  /** Rough calorie estimate for the loop */
  estimatedCalories: number
  /** Closed loop polyline (start ≈ end) */
  path: GeoPoint[]
  /** Turn-by-turn style cues (AI or map provider later) */
  turns: RouteTurn[]
  createdAt: string
  /** Freeform notes from AI planner */
  aiNotes?: string
}

/** User-saved route (guest: localStorage) */
export interface FavoriteRoute extends PlannedRoute {
  favoritedAt: string
  /** Optional user label; falls back to summary */
  favoriteName?: string
}

export interface RouteTurn {
  id: string
  /** Index into path (approx) */
  pathIndex: number
  instruction: string
  /** meters before the turn to speak/show cue */
  announceDistanceMeters: number
}

export type TrainingGoalKind =
  | 'race_time' // e.g. 5k in 25:00
  | 'distance_time' // x miles in y minutes in z days
  | 'calories_per_run'

export interface TrainingPlan {
  id: string
  title: string
  goalKind: TrainingGoalKind
  /** e.g. "5k", "3.1 mi" */
  targetLabel: string
  /** Target time in seconds, if applicable */
  targetTimeSeconds?: number
  /** Days until goal */
  days: number
  /** Calories target per run, if applicable */
  caloriesPerRun?: number
  /** AI-generated session outline */
  sessions: TrainingSession[]
  createdAt: string
  notes?: string
}

export interface TrainingSession {
  day: number
  title: string
  description: string
  /** Suggested distance meters or null for rest */
  distanceMeters?: number
  /** Suggested pace sec/km or sec/mi depending on unit preference */
  targetPaceSecondsPerUnit?: number
  isRest?: boolean
}

export interface CoachContext {
  /** current speed m/s */
  speedMps: number | null
  /** target pace as m/s (higher = faster) */
  targetSpeedMps: number | null
  distanceRemainingMeters: number
  distanceDoneMeters: number
  elapsedSeconds: number
  /** 0–1 progress along route */
  progress: number
  phase: 'warmup' | 'steady' | 'push' | 'finish'
  offRoute?: boolean
}

export interface CoachNudge {
  id: string
  message: string
  tone: 'encourage' | 'ease' | 'push' | 'info' | 'celebrate'
  /** When generated */
  at: string
}

export interface RunSplit {
  /** 1-based split number */
  index: number
  unit: DistanceUnit
  /** Length of this split (meters) */
  splitMeters: number
  /** Cumulative along-route (or GPS) distance at end of split */
  cumulativeMeters: number
  /** Elapsed seconds for this split only */
  durationSeconds: number
  /** Pace for this split, sec per mi or km */
  paceSecondsPerUnit: number
  at: string
}

export interface RunLog {
  id: string
  routeId: string | null
  routeSummary: string
  startedAt: string
  finishedAt: string | null
  /** Raw GPS track distance (meters) */
  distanceMeters: number
  /**
   * Max distance along the planned route (meters).
   * Preferred for progress on a loop.
   */
  alongRouteMeters: number
  durationSeconds: number
  estimatedCalories: number
  avgSpeedMps: number | null
  samples: GeoPoint[]
  nudges: CoachNudge[]
  completed: boolean
  /** Closed the loop near start after covering most of the route */
  loopCompleted: boolean
  /** Last known off-route state */
  offRoute: boolean
  splits: RunSplit[]
  /** Target speed from training session (m/s), if any */
  targetSpeedMps: number | null
  planId: string | null
  planDay: number | null
  sessionTitle: string | null
}

export interface StartRunOptions {
  targetSpeedMps?: number | null
  planId?: string | null
  planDay?: number | null
  sessionTitle?: string | null
}

export interface GuestProfile {
  id: string
  displayName: string
  unit: DistanceUnit
  /** Default turn announce distance (meters) — "close to turns" */
  turnAnnounceMeters: number
  weightKg: number
  createdAt: string
  /** Browser TTS master switch */
  voiceEnabled: boolean
  /** Speak coach nudges */
  voiceCoach: boolean
  /** Speak turn-by-turn cues */
  voiceTurns: boolean
  /** Speech rate 0.5–2 */
  voiceRate: number
  /**
   * Keep the screen on during an active run (Screen Wake Lock).
   * Helps GPS + speaker stay reliable; uses more battery.
   */
  keepScreenOnDuringRun: boolean
  /** Off-route threshold in meters */
  offRouteMeters: number
}
