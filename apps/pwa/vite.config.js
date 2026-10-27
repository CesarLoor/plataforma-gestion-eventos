import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      includeAssets: ['icono.svg'],
      manifest: {
        name: 'Aforo · Eventos locales',
        short_name: 'Aforo',
        description: 'Entradas sin sobreventa, tickets con QR firmado y control de acceso sin conexión',
        lang: 'es',
        start_url: '/',
        display: 'standalone',
        background_color: '#F5F6F8',
        theme_color: '#3438C9',
        icons: [{ src: 'icono.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/pasarela\//],
      },
    }),
  ],
  server: { proxy: { '/api': { target: 'https://localhost', secure: false }, '/pasarela': { target: 'https://localhost', secure: false } } },
});
