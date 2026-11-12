import { defineConfig } from 'vite'

// The packaged local server: one self-contained file that runs on plain
// Node 22 with no node_modules. Every dependency is bundled in.
export default defineConfig({
  publicDir: false,
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: 'server/local/main.ts',
    outDir: 'dist-local',
    emptyOutDir: true,
    sourcemap: false,
    target: 'node22',
    // undici probes node:sqlite lazily inside try/catch; keep it lazy so the
    // server still starts on Node builds without it.
    commonjsOptions: { ignore: ['node:sqlite'] },
    rollupOptions: {
      output: {
        entryFileNames: 'server.mjs',
        format: 'es',
        banner:
          "import { createRequire as __steerloomRequire } from 'node:module';\nconst require = __steerloomRequire(import.meta.url);",
      },
    },
  },
})
