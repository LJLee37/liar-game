/**
 * 클라이언트 빌드 설정 (Vite + Vue + Quasar)
 * - Vite: https://ko.vite.dev/config/
 * - Quasar Vite 플러그인: https://quasar.dev/start/vite-plugin
 *
 * 개발 중(npm run dev)에는 Vite 개발 서버(5173)가 화면을 제공하고,
 * /socket.io 요청은 게임 서버(3000)로 넘겨준다(proxy).
 */
import { fileURLToPath, URL } from 'node:url'
import { quasar, transformAssetUrls } from '@quasar/vite-plugin'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: path('./client'),
  plugins: [
    vue({ template: { transformAssetUrls } }),
    quasar({ sassVariables: path('./client/src/quasar-variables.sass') }),
  ],
  build: {
    outDir: path('./dist/client'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/socket.io': { target: `http://localhost:${process.env.PORT ?? 3000}`, ws: true },
    },
  },
})
