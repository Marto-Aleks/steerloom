import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: 'server/hosted/main.ts',
    outDir: 'dist-server',
    sourcemap: false,
    rollupOptions: { output: { entryFileNames: 'main.js' } },
  },
})
