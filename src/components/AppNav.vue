<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()

const items = [
  { to: '/', label: 'Home', match: ['home'] },
  { to: '/plan', label: 'Plan', match: ['plan-run'] },
  { to: '/run', label: 'Run', match: ['run'] },
  { to: '/train', label: 'Train', match: ['train'] },
  { to: '/history', label: 'Log', match: ['history'] },
] as const

const activeName = computed(() => String(route.name ?? ''))
</script>

<template>
  <nav class="bottom-nav" aria-label="Primary">
    <RouterLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="nav-item"
      :class="{ active: item.match.includes(activeName as never) }"
    >
      {{ item.label }}
    </RouterLink>
  </nav>
</template>
