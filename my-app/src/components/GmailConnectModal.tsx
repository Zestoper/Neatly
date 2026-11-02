import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Mail, X } from "lucide-react";
import { api } from "../api/client";
import { getMe } from "../api/auth";
import styles from "./GmailConnectModal.module.css";

// 이번 접속에서 이미 보여줬는지 / '다시 보지 않기'를 눌렀는지 (브라우저별 편의 기능이라 저장 실패해도 동작에는 문제 없음)
const SESSION_KEY = "gmail_connect_prompt_shown";
const NEVER_KEY = "gmail_connect_prompt_never";

function safeGet(storage: Storage, key: string) {
    try { return storage.getItem(key); } catch { return null; }
}
function safeSet(storage: Storage, key: string, value: string) {
    try { storage.setItem(key, value); } catch { /* 저장 불가 환경이면 무시 */ }
}

/**
 * 로그인 후 Gmail이 연결돼 있지 않으면 연결을 안내하는 모달.
 * - 연결이 만료된 경우(예전에 연결했던 계정)는 '다시 연결' 문구로 보여준다
 * - 나중에: 이번 접속 동안 다시 안 뜸 / 다시 보지 않기: 이 브라우저에서 안 뜸 (단 만료 안내는 계속 띄움)
 * - Settings · Emails 화면에는 이미 연결 버튼이 있어서 띄우지 않는다
 */
export default function GmailConnectModal() {
    const location = useLocation();
    const [state, setState] = useState<"hidden" | "new" | "expired">("hidden");
    const [connecting, setConnecting] = useState(false);

    useEffect(() => {
        if (safeGet(sessionStorage, SESSION_KEY)) return;
        getMe()
            .then((me) => {
                if (me.gmail_access_token) return;
                if (me.gmail_expired) setState("expired");
                else if (!safeGet(localStorage, NEVER_KEY)) setState("new");
            })
            .catch(() => {});
    }, []);

    const onSkipPage = ["/settings", "/emails"].some((p) => location.pathname.startsWith(p));
    if (state === "hidden" || onSkipPage) return null;

    const close = (never = false) => {
        safeSet(sessionStorage, SESSION_KEY, "1");
        if (never) safeSet(localStorage, NEVER_KEY, "1");
        setState("hidden");
    };

    const connect = async () => {
        setConnecting(true);
        try {
            const res = await api.get("/auth/gmail");
            safeSet(sessionStorage, SESSION_KEY, "1");
            window.location.href = res.data.url;
        } catch {
            setConnecting(false);
        }
    };

    const expired = state === "expired";

    return (
        <div className={styles.overlay} onClick={() => close()}>
            <div className={styles.box} role="dialog" aria-modal="true" aria-labelledby="gmail-connect-title" onClick={(e) => e.stopPropagation()}>
                <button className={styles.close} onClick={() => close()} aria-label="닫기">
                    <X size={16} />
                </button>
                <div className={styles.icon}><Mail size={22} /></div>
                <h2 id="gmail-connect-title">{expired ? "Gmail 연결이 끊겼어요" : "Gmail을 연결해보세요"}</h2>
                <p className={styles.desc}>
                    {expired
                        ? "Google 계정의 연결이 만료돼서 새 메일을 가져오지 못하고 있어요. 다시 연결하면 바로 이어서 정리해드려요."
                        : "메일이 오면 AI가 바로 요약해서 문서로 정리하고 마감일이 있는 할 일은 캘린더에 넣을지 물어봐요."}
                </p>
                {!expired && (
                    <ul className={styles.points}>
                        <li>새 메일 실시간 정리 · AI 요약</li>
                        <li>메일 속 할 일을 캘린더 일정으로 제안</li>
                        <li>AI 답장 초안 · 오늘의 브리핑</li>
                    </ul>
                )}
                <div className={styles.actions}>
                    {!expired && <button className={styles.textBtn} onClick={() => close(true)}>다시 보지 않기</button>}
                    <button className={styles.laterBtn} onClick={() => close()}>나중에</button>
                    <button className={styles.connectBtn} onClick={connect} disabled={connecting}>
                        {connecting ? "이동 중..." : expired ? "다시 연결하기" : "Gmail 연결하기"}
                    </button>
                </div>
            </div>
        </div>
    );
}
