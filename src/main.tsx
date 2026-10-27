import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { setActiveCurrency } from './lib/currency'
import {
  hydrateDesktopStorage,
  loadCurrency,
  loadFontSize,
} from './lib/storage'
import {
  hydrateBulkStorage,
  migrateLegacyBulkStorage,
} from './lib/bulkStore'
import './styles.css'
import './budget.css'

async function bootstrap() {
  // Load the IndexedDB cache before anything reads storage, then let the
  // desktop mirror win when its file is newer, and only then retire the old
  // localStorage copies.
  await hydrateBulkStorage()
  await hydrateDesktopStorage()
  await migrateLegacyBulkStorage()
  // Apply saved preferences before the first paint so they do not flash.
  setActiveCurrency(loadCurrency())
  document.documentElement.dataset.fontSize = loadFontSize()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
