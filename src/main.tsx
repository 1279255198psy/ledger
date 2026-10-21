import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { setActiveCurrency } from './lib/currency'
import {
  hydrateDesktopStorage,
  loadCurrency,
  loadFontSize,
} from './lib/storage'
import './styles.css'

async function bootstrap() {
  await hydrateDesktopStorage()
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
