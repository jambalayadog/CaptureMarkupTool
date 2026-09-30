import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { isElectron } from './core/platform'
import './styles.css'

if (isElectron) document.body.classList.add('electron')
createRoot(document.getElementById('root')!).render(<App />)
