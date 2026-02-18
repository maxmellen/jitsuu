import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['kotobank.sqlite'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm}'],
        runtimeCaching: [
          {
            urlPattern: /kotobank\.sqlite$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'kotobank-db',
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            urlPattern: /sql-wasm\.wasm$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'sql-wasm',
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
      manifest: {
        name: '字通検索',
        short_name: '字通',
        start_url: '/',
        display: 'standalone',
        background_color: '#f6f2ec',
        theme_color: '#b04a2f',
      },
    }),
  ],
})
