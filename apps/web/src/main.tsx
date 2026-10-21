import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { App } from './App.js'
import './styles.css'

// Without a DSN, reporting is off and the Sentry handlers below do nothing.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) Sentry.init({ dsn: sentryDsn, environment: import.meta.env.MODE })

const root = createRoot(document.getElementById('root')!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
})
// PROTOTYPE (T17.1, #203): throwaway style prototype, dev builds only. Remove with the folder.
if (import.meta.env.DEV && location.pathname === '/prototype/style')
  void import('./prototype-style/StylePrototype.js').then(({ StylePrototype }) =>
    root.render(<StylePrototype />),
  )
else
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
