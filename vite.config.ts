import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Link previews need absolute image URLs. On Vercel the production domain
// is exposed at build time as VERCEL_PROJECT_PRODUCTION_URL; SITE_URL can
// override it (e.g. a custom domain). Falls back to relative paths locally.
const siteUrl = (
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
).replace(/\/$/, '')

const siteUrlPlugin = {
  name: 'site-url',
  transformIndexHtml: (html: string) => html.replaceAll('%SITE_URL%', siteUrl),
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), siteUrlPlugin],
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
