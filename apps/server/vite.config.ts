import { defineConfig } from 'vite'
import path from 'node:path'

const repositoryRoot = path.resolve(__dirname, '../..')

export default defineConfig({
  root: repositoryRoot,
  resolve: {
    alias: {
      '@': path.resolve(repositoryRoot, 'apps/web/src'),
      '@dice/game-domain': path.resolve(repositoryRoot, 'packages/game-domain/src/index.ts'),
      '@dice/physics-core': path.resolve(repositoryRoot, 'packages/physics-core/src/index.ts'),
      '@dice/protocol': path.resolve(repositoryRoot, 'packages/protocol/src/index.ts'),
    },
  },
  ssr: {
    noExternal: ['@dice/game-domain', '@dice/physics-core', '@dice/protocol'],
  },
  build: {
    ssr: path.resolve(repositoryRoot, 'apps/server/src/index.ts'),
    target: 'node22',
    outDir: path.resolve(repositoryRoot, 'dist-server'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
})
