import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'apps/web/src'),
      '@dice/game-domain': path.resolve(__dirname, 'packages/game-domain/src/index.ts'),
      '@dice/physics-core': path.resolve(__dirname, 'packages/physics-core/src/index.ts'),
      '@dice/protocol': path.resolve(__dirname, 'packages/protocol/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./apps/web/src/__tests__/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', 'sweep/**'],
  },
})
