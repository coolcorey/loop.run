import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { DistanceUnit, GuestProfile } from '@/types'
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
  }
})
