import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { CoachVoiceMode, DistanceUnit, GuestProfile } from '@/types'
import { loadJson, saveJson, uid } from '@/services/storage'

const STORAGE_KEY = 'loop.guest'

function defaultProfile(): GuestProfile {
  return {
    id: uid('guest'),
    displayName: 'Guest',
    unit: 'mi',
    turnAnnounceMeters: 40,
    weightKg: 75,
    createdAt: new Date().toISOString(),
    voiceEnabled: true,
    voiceCoach: true,
    voiceTurns: true,
    voiceRate: 1.05,
    keepScreenOnDuringRun: true,
    offRouteMeters: 45,
    athleteNotes: '',
    autoDebrief: true,
    autoSplitCommentary: true,
    autoMilestones: true,
    autoSessionBrief: true,
    coachVoice: 'coach',
    localColor: true,
  }
}

function migrateProfile(raw: Partial<GuestProfile> | null): GuestProfile {
  const base = defaultProfile()
  if (!raw) return base
  return {
    ...base,
    ...raw,
    voiceEnabled: raw.voiceEnabled ?? true,
    voiceCoach: raw.voiceCoach ?? true,
    voiceTurns: raw.voiceTurns ?? true,
    voiceRate: raw.voiceRate ?? 1.05,
    keepScreenOnDuringRun: raw.keepScreenOnDuringRun ?? true,
    offRouteMeters: raw.offRouteMeters ?? 45,
    athleteNotes: raw.athleteNotes ?? '',
    autoDebrief: raw.autoDebrief ?? true,
    autoSplitCommentary: raw.autoSplitCommentary ?? true,
    autoMilestones: raw.autoMilestones ?? true,
    autoSessionBrief: raw.autoSessionBrief ?? true,
    coachVoice: raw.coachVoice ?? 'coach',
    localColor: raw.localColor ?? true,
  }
}

export const useGuestStore = defineStore('guest', () => {
  const profile = ref<GuestProfile>(
    migrateProfile(loadJson<Partial<GuestProfile> | null>(STORAGE_KEY, null)),
  )

  watch(
    profile,
    (p) => saveJson(STORAGE_KEY, p),
    { deep: true },
  )

  const unit = computed(() => profile.value.unit)

  function setUnit(unit: DistanceUnit) {
    profile.value.unit = unit
  }

  function setTurnAnnounceMeters(meters: number) {
    profile.value.turnAnnounceMeters = Math.max(15, Math.min(200, meters))
  }

  function setWeightKg(kg: number) {
    profile.value.weightKg = Math.max(30, Math.min(250, kg))
  }

  function setDisplayName(name: string) {
    profile.value.displayName = name.trim() || 'Guest'
  }

  function setVoiceEnabled(on: boolean) {
    profile.value.voiceEnabled = on
  }

  function setVoiceCoach(on: boolean) {
    profile.value.voiceCoach = on
  }

  function setVoiceTurns(on: boolean) {
    profile.value.voiceTurns = on
  }

  function setVoiceRate(rate: number) {
    profile.value.voiceRate = Math.min(2, Math.max(0.5, rate))
  }

  function setKeepScreenOnDuringRun(on: boolean) {
    profile.value.keepScreenOnDuringRun = on
  }

  function setOffRouteMeters(meters: number) {
    profile.value.offRouteMeters = Math.max(20, Math.min(120, meters))
  }

  function setAthleteNotes(notes: string) {
    profile.value.athleteNotes = notes.slice(0, 500)
  }

  function setAutoDebrief(on: boolean) {
    profile.value.autoDebrief = on
  }

  function setAutoSplitCommentary(on: boolean) {
    profile.value.autoSplitCommentary = on
  }

  function setAutoMilestones(on: boolean) {
    profile.value.autoMilestones = on
  }

  function setAutoSessionBrief(on: boolean) {
    profile.value.autoSessionBrief = on
  }

  function setCoachVoice(mode: CoachVoiceMode) {
    profile.value.coachVoice = mode
  }

  function setLocalColor(on: boolean) {
    profile.value.localColor = on
  }

  return {
    profile,
    unit,
    setUnit,
    setTurnAnnounceMeters,
    setWeightKg,
    setDisplayName,
    setVoiceEnabled,
    setVoiceCoach,
    setVoiceTurns,
    setVoiceRate,
    setKeepScreenOnDuringRun,
    setOffRouteMeters,
    setAthleteNotes,
    setAutoDebrief,
    setAutoSplitCommentary,
    setAutoMilestones,
    setAutoSessionBrief,
    setCoachVoice,
    setLocalColor,
  }
})
