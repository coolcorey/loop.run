import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
      meta: { title: 'Loop' },
    },
    {
      path: '/plan',
      name: 'plan-run',
      component: () => import('@/views/PlanRunView.vue'),
      meta: { title: 'Plan a run' },
    },
    {
      path: '/train',
      name: 'train',
      component: () => import('@/views/PlansView.vue'),
      meta: { title: 'Train' },
    },
    // Old path
    { path: '/plans', redirect: '/train' },
    {
      path: '/run',
      name: 'run',
      component: () => import('@/views/RunView.vue'),
      meta: { title: 'Run' },
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('@/views/HistoryView.vue'),
      meta: { title: 'History' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { title: 'Settings' },
    },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

router.afterEach((to) => {
  const title = (to.meta.title as string | undefined) ?? 'Loop'
  document.title = title === 'Loop' ? 'Loop' : `${title} · Loop`
})

export default router
