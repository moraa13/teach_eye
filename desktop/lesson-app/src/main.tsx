import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const rootElement = document.getElementById('root')

// #region agent log
fetch('http://127.0.0.1:7711/ingest/ea4dba9c-75d7-4a3b-928e-7c8b2a9adba1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d405cf'},body:JSON.stringify({sessionId:'d405cf',runId:'pre-fix',hypothesisId:'H1',location:'main.tsx:7',message:'main_bootstrap',data:{hasRoot:Boolean(rootElement),href:window.location.href,readyState:document.readyState},timestamp:Date.now()})}).catch(()=>{});
// #endregion

createRoot(rootElement!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
