import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { loadLang } from '@csp/lang-wasm'
import { App } from './App.js'
import { applyTheme } from './ui/theme.js'
import './styles/index.css'

// Theme colours and fonts as CSS custom properties, before anything renders.
applyTheme(document.documentElement.style)

// Without a DSN, reporting is off and the Sentry handlers below do nothing.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) Sentry.init({ dsn: sentryDsn, environment: import.meta.env.MODE })

// The game's rules run in the WebAssembly module (ADR 0045), called synchronously as the UI
// renders: it loads before the first render.
await loadLang()

createRoot(document.getElementById('root')!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
