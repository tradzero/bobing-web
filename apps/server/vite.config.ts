import { defineConfig } from 'vite'
import path from 'node:path'

const repositoryRoot = path.resolve(__dirname, '../..')
const physicsCoreRoot = path.resolve(repositoryRoot, 'packages/physics-core/src')

export default defineConfig({
  root: repositoryRoot,
  resolve: {
    alias: {
      '@dice/physics-core/dice/throw': path.resolve(physicsCoreRoot, 'dice/throw-runtime.ts'),
      '@dice/physics-core/dice/settle': path.resolve(physicsCoreRoot, 'dice/settle-runtime.ts'),
      '@dice/physics-core/physics/world': path.resolve(
        physicsCoreRoot,
        'physics/world-optimized-runtime.ts',
      ),
      '@dice/game-domain': path.resolve(repositoryRoot, 'packages/game-domain/src/index.ts'),
      '@dice/physics-core': physicsCoreRoot,
      '@dice/protocol': path.resolve(repositoryRoot, 'packages/protocol/src/index.ts'),
    },
  },
  ssr: {
    noExternal: ['@dice/game-domain', '@dice/physics-core', '@dice/protocol'],
  },
  build: {
    ssr: true,
    target: 'node24',
    outDir: path.resolve(repositoryRoot, 'dist-server'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(repositoryRoot, 'apps/server/src/index.ts'),
        'roll-worker': path.resolve(repositoryRoot, 'apps/server/src/roll/worker.ts'),
      },
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
})
