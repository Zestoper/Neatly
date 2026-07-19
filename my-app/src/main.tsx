import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ServerWakeGate from './components/ServerWakeGate.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServerWakeGate>
      <App />
    </ServerWakeGate>
  </StrictMode>,
)
