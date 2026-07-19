import { useEffect, useState, type ReactNode } from "react";
import styles from "./ServerWakeGate.module.css";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export default function ServerWakeGate({ children }: { children: ReactNode }) {
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout>;

        async function ping() {
            try {
                const controller = new AbortController();
                const abortTimer = setTimeout(() => controller.abort(), 8000);
                const res = await fetch(`${BASE_URL}/health`, { signal: controller.signal });
                clearTimeout(abortTimer);
                if (res.ok) {
                    if (!cancelled) setConnected(true);
                    return;
                }
            } catch {
                // 서버가 아직 깨어나는 중 - 잠시 후 재시도
            }
            if (!cancelled) retryTimer = setTimeout(ping, 2000);
        }

        ping();
        return () => {
            cancelled = true;
            clearTimeout(retryTimer);
        };
    }, []);

    if (connected) return <>{children}</>;

    return (
        <div className={styles.gate}>
            <div className={styles.spinner} />
            <p className={styles.title}>서버에 연결하는 중입니다...</p>
            <p className={styles.subtitle}>무료 버전이라 최대 30초 정도 소요될 수 있어요</p>
        </div>
    );
}
