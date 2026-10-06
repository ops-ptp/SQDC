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

// The `testing` branch ALWAYS talks to the separate SQDC-testing Supabase
// project, never production — even if Vercel's Preview environment variables
// still point at the production database. (These are the testing project's
// public anon credentials — the same kind every browser already receives.)
// Has no effect on any other branch, so it's harmless after a merge to main.
const TESTING_BRANCH_SUPABASE =
  process.env.VERCEL_GIT_COMMIT_REF === 'testing'
    ? {
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://cfipcfqkzpjybzhviimr.supabase.co'),
        'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNmaXBjZnFrenBqeWJ6aHZpaW1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzI4NTIsImV4cCI6MjEwNjgwODg1Mn0.CmQ0UTBqEpyXO78pSLw0GFlDtWmyTFvnwFa5sJoFsAY'
        ),
      }
    : {}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), siteUrlPlugin],
  define: TESTING_BRANCH_SUPABASE,
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
