import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getMe } from "../api/auth";
import styles from "./Auth.module.css";

// 구글/카카오 로그인 후 백엔드가 /oauth/callback#token=... 으로 보내준다.
// 토큰을 저장하고 내 정보를 받아 로그인 상태로 만든 뒤 대시보드로 이동한다.
export default function OAuthCallback() {
    const navigate = useNavigate();
    const done = useRef(false); // 개발 모드(StrictMode)에서 effect 가 두 번 도는 것 방지

    useEffect(() => {
        if (done.current) return;
        done.current = true;

        const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
        // 주소창에서 토큰을 지운다 (뒤로가기·복사로 새지 않게)
        window.history.replaceState(null, "", window.location.pathname);

        if (!token) {
            navigate("/login", { replace: true, state: { error: "로그인 정보를 받지 못했습니다" } });
            return;
        }

        localStorage.setItem("token", token);
        getMe()
            .then((me) => {
                localStorage.setItem("plan", me.plan);
                localStorage.setItem("userName", me.name || me.email);
                navigate("/dashboard", { replace: true });
            })
            .catch(() => {
                localStorage.removeItem("token");
                navigate("/login", { replace: true, state: { error: "로그인에 실패했습니다. 다시 시도해주세요" } });
            });
    }, [navigate]);

    return (
        <div className={styles.page}>
            <div className={styles.card}>
                <p className={styles.title}>Neatly</p>
                <p className={styles.loadingText}>로그인 중이에요…</p>
            </div>
        </div>
    );
}
