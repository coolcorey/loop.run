import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // HTTPS so phones can use geolocation on LAN (http://192.168.x.x blocks GPS)
    basicSsl(),
    vue(),
    VitePWA({
      // Disabled until we ship install/offline; config stays ready.
      // Set to 'prompt' or 'autoUpdate' when enabling the PWA.
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: {
        name: 'Loop',
        short_name: 'Loop',
        description: 'Plan loops. Run with a coach. Come back to where you started.',
        theme_color: '#0f1419',
        background_color: '#0f1419',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Listen on LAN; pair with HTTPS from basicSsl for mobile GPS
    host: true,
    port: 9090,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
