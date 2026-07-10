<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppNav from '@/components/AppNav.vue'
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <RouterLink to="/" class="brand">
        <span class="brand-mark">↻</span>
        <span class="brand-name">loop</span><span class="brand-tld">.run</span>
      </RouterLink>
      <span class="guest-pill" title="Guest mode — data stays on this device">Guest</span>
    </header>

    <main class="main">
      <RouterView />
    </main>

    <AppNav />
  </div>
</template>
