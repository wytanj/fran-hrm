import { fileURLToPath } from 'node:url'

// FranHRM — Nuxt 4 app + Nitro API + remote MCP endpoint.
//
// nitro.externals.inline: Nitro externalises plain .mjs directories outside
// server/, and on Windows the emitted specifier loses its drive prefix and
// resolves to C:\core\... — 500-ing every route that imports shared logic.
// Force-inlining core/ and mcp/ avoids that (same workaround as fran-skums);
// the entries must be ABSOLUTE paths or they never match the resolved ids.
const root = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: false },
  modules: ['@nuxtjs/tailwindcss'],
  nitro: {
    externals: {
      inline: [`${root}core`, `${root}mcp`],
    },
  },
  runtimeConfig: {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseServiceKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    public: {
      appName: 'FranHRM',
    },
  },
  app: {
    // Short cross-fade. `out-in` avoids the two pages overlapping, and 120ms is
    // long enough to read as intentional without adding perceptible delay.
    pageTransition: { name: 'page', mode: 'out-in' },
    head: {
      title: 'FranHRM',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#FFFEF5' },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap',
        },
      ],
    },
  },
})
