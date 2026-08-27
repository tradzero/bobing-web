import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const repositoryRoot = __dirname
  const webRoot = path.resolve(repositoryRoot, 'apps/web')

  return {
    root: webRoot,
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(webRoot, 'src'),
        '@dice/game-domain': path.resolve(repositoryRoot, 'packages/game-domain/src/index.ts'),
        '@dice/physics-core': path.resolve(repositoryRoot, 'packages/physics-core/src/index.ts'),
        '@dice/protocol': path.resolve(repositoryRoot, 'packages/protocol/src/index.ts'),
      },
    },
    build: {
      outDir: path.resolve(repositoryRoot, mode === 'e2e' ? '.e2e-dist' : 'dist'),
      emptyOutDir: true,
    },
  }
})
