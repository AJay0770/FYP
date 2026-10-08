import React from 'react'
import ReactDOM from 'react-dom/client'
// ▼ EDIT: global colours/fonts/spacing are loaded here - edit them in src/styles/tokens.css
import './styles/tokens.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
