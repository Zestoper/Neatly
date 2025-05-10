import { StrictMode } from 'react'         // StrictMode : 개발 중 잠재적 문제를 감지해 경고 출력
import { createRoot } from 'react-dom/client' // createRoot : React 18의 렌더링 진입점
import './index.css'
import App from './App.tsx'

// document.getElementById('root') : index.html의 <div id="root">에 React 앱을 마운트
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
