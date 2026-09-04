import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const repositoryRoot = __dirname
  const webRoot = path.resolve(repositoryRoot, 'apps/web')
  const physicsCoreRoot = path.resolve(repositoryRoot, 'packages/physics-core/src')
  const runtimeOnlyAliases: Record<string, string> =
    mode === 'e2e' || mode === 'lab'
      ? {}
      : {
          '@dice/physics-core/dice/throw': path.resolve(physicsCoreRoot, 'dice/throw-runtime.ts'),
          '@dice/physics-core/dice/settle': path.resolve(physicsCoreRoot, 'dice/settle-runtime.ts'),
          '@dice/physics-core/physics/world': path.resolve(
            physicsCoreRoot,
            'physics/world-runtime.ts',
          ),
          '@/game/physics-collision-experiment': path.resolve(
            webRoot,
            'src/game/physics-collision-runtime.ts',
          ),
          '@/game/physics-scheduler-experiment': path.resolve(
            webRoot,
            'src/game/physics-scheduler-runtime.ts',
          ),
          '@/game/render-performance-experiment': path.resolve(
            webRoot,
            'src/game/render-performance-runtime.ts',
          ),
          '@/game/performance-profile': path.resolve(
            webRoot,
            'src/game/performance-profile-runtime.ts',
          ),
        }

  return {
    root: webRoot,
    plugins: [react()],
    resolve: {
      alias: {
        ...runtimeOnlyAliases,
        '@': path.resolve(webRoot, 'src'),
        '@dice/game-domain': path.resolve(repositoryRoot, 'packages/game-domain/src/index.ts'),
        '@dice/physics-core': physicsCoreRoot,
        '@dice/protocol': path.resolve(repositoryRoot, 'packages/protocol/src/index.ts'),
      },
    },
    build: {
      outDir: path.resolve(repositoryRoot, mode === 'e2e' ? '.e2e-dist' : 'dist'),
      emptyOutDir: true,
    },
  }
})
