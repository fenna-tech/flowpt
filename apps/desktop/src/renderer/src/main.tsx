import '@flowpt/ui/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@flowpt/ui'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
