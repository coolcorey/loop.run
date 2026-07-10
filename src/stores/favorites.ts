import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { FavoriteRoute, PlannedRoute } from '@/types'
import { loadJson, saveJson } from '@/services/storage'

const KEY = 'loop.favorites'

export const useFavoritesStore = defineStore('favorites', () => {
  const favorites = ref<FavoriteRoute[]>(loadJson(KEY, []))

  watch(favorites, (v) => saveJson(KEY, v), { deep: true })

  const count = computed(() => favorites.value.length)

  function isFavorite(routeId: string | null | undefined): boolean {
    if (!routeId) return false
    return favorites.value.some((f) => f.id === routeId)
  }

  function addFavorite(route: PlannedRoute, name?: string): FavoriteRoute {
    const existing = favorites.value.find((f) => f.id === route.id)
    if (existing) {
      if (name?.trim()) existing.favoriteName = name.trim()
      return existing
    }

    const fav: FavoriteRoute = {
      ...route,
      path: route.path.map((p) => ({ ...p })),
      turns: route.turns.map((t) => ({ ...t })),
      favoritedAt: new Date().toISOString(),
      favoriteName: name?.trim() || undefined,
    }
    favorites.value = [fav, ...favorites.value].slice(0, 50)
    return fav
  }

  function removeFavorite(routeId: string) {
    favorites.value = favorites.value.filter((f) => f.id !== routeId)
  }

  function toggleFavorite(route: PlannedRoute): boolean {
    if (isFavorite(route.id)) {
      removeFavorite(route.id)
      return false
    }
    addFavorite(route)
    return true
  }

  function renameFavorite(routeId: string, name: string) {
    const fav = favorites.value.find((f) => f.id === routeId)
    if (!fav) return
    fav.favoriteName = name.trim() || undefined
  }

  function getById(routeId: string): FavoriteRoute | undefined {
    return favorites.value.find((f) => f.id === routeId)
  }

  return {
    favorites,
    count,
    isFavorite,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    renameFavorite,
    getById,
  }
})
