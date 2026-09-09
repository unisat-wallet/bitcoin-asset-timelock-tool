import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { execFileSync } from 'node:child_process'

function getBuildCommitHash() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12)

  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return 'unknown'
  }
}

const buildCommitHash = getBuildCommitHash()

export default defineConfig({
  plugins: [wasm(), topLevelAwait(), react()],
  base: process.env.VITE_BASE_PATH || './',
  build: {
    target: 'esnext',
  },
  define: {
    global: 'globalThis',
    __BUILD_COMMIT_HASH__: JSON.stringify(buildCommitHash),
  },
  optimizeDeps: {
    include: ['buffer', 'process'],
  },
  resolve: {
    alias: {
      buffer: 'buffer',
      process: 'process/browser',
    },
  },
})
