import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { createBrowserSession } from './storage/browserSession'

const session = createBrowserSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App {...session} />
  </StrictMode>,
)
