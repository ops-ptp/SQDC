import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  css: {
    preprocessorOptions: {
      // Kendo's theme SCSS triggers Sass deprecation notices we can't fix
      // from here — keep them out of the build log.
      scss: { quietDeps: true, silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'if-function'] },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Keep the big, rarely-changing libraries in their own cached chunks.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@progress')) return 'kendo'
          if (id.includes('recharts') || id.includes('d3-')) return 'charts'
          if (id.includes('exceljs')) return 'exceljs'
          return undefined
        },
      },
    },
  },
})
