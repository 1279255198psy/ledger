import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { hydrateDesktopStorage } from './lib/storage'
import './styles.css'

async function bootstrap() {
  await hydrateDesktopStorage()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
