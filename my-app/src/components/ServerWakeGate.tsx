import { useEffect, useState, type ReactNode } from 'react'
import styles from "./ServerWakeGate.module.css"

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
const HEALTH_URL = `${BASE_URL}/health`


// 화면은 바로 보여주고 백그라운드에서만 서버를 깨운다 (Render 무료 플랜 cold start 대응)
// 2.5초 안에 응답이 없을 때만 하단에 작은 안내 배너를 띄운다
export default function ServerWakeGate({ children }: { children: ReactNode }) {
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout>
    const bannerTimer = setTimeout(() => {
      if (!cancelled) setShowBanner(true)
    }, 2500)

    async function ping() {
      try {
        const controller = new AbortController()
        const abortTimer = setTimeout(() => controller.abort(), 8000)
        const res = await fetch(HEALTH_URL, { signal: controller.signal })
        clearTimeout(abortTimer)
        if (res.ok) {
          clearTimeout(bannerTimer)
          if (!cancelled) setShowBanner(false)
          return
        }
      } catch {
        // 서버가 아직 깨어나는 중 - 잠시 후 재시도
      }
      if (!cancelled) retryTimer = setTimeout(ping, 3000)
    }

    ping()
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      clearTimeout(bannerTimer)
    }
  }, [])

  return (
    <>
      {children}
      {showBanner && (
        <div className={styles.banner} role="status" aria-live="polite">
          <span className={styles.spinner} />
          <span>서버를 깨우는 중이에요 · 첫 요청은 최대 1분 걸릴 수 있어요</span>
        </div>
      )}
    </>
  )
}
