import type {
  CoachContext,
  CoachNudge,
  DistanceUnit,
  GeoPoint,
  PlannedRoute,
  RouteGoalKind,
  TrainingGoalKind,
  TrainingPlan,
} from '@/types'

export interface PlanRouteInput {
  origin: GeoPoint
  goalKind: RouteGoalKind
  /** miles/km or calories depending on goalKind */
  targetValue: number
  unit: DistanceUnit
  weightKg: number
  /** turn announce distance preference */
  turnAnnounceMeters: number
  preferences?: string
  /** Force a different loop direction (0–359). Used for “different route”. */
  startBearing?: number
  /** Skip sticky AI bearing / force a fresh variation */
  regenerate?: boolean
}

export interface GeneratePlanInput {
  goalKind: TrainingGoalKind
  /** e.g. "5k", "10 miles" */
  targetLabel: string
  targetTimeSeconds?: number
  days: number
  caloriesPerRun?: number
  unit: DistanceUnit
  notes?: string
}

export interface AiProvider {
  readonly name: string
  planRoute(input: PlanRouteInput): Promise<PlannedRoute>
  generateTrainingPlan(input: GeneratePlanInput): Promise<TrainingPlan>
  coachNudge(ctx: CoachContext): Promise<CoachNudge>
}
