import { useState } from "react";
import { Link } from "react-router-dom"; // Link : 페이지 이동 컴포넌트
import { loginUser, getMe } from "../api/auth";
import { useToast } from "../context/ToastContext";
import styles from "./Auth.module.css";  // Auth.module.css : Login, Register 공용 스타일

export default function Login() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();

    const handleLogin = async () => {
        setLoading(true);
        try {
            const data = await loginUser(email, password);
            localStorage.setItem("token", data.access_token);
            const me = await getMe(); // 로그인 직후 사용자 정보 조회
            localStorage.setItem("plan", me.plan); // plan : FREE / STANDARD / PREMIUM
            window.location.href = "/";
        } catch {
            showToast("이메일 또는 비밀번호를 다시 확인해주세요.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.card}>
                <p className={styles.title}>Neatly</p>

                <input
                    className={styles.input}
                    placeholder="이메일"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />
                <input
                    className={styles.input}
                    type="password"
                    placeholder="비밀번호"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
                />

                <button className={styles.button} onClick={handleLogin} disabled={loading}>
                    {loading ? "로그인 중..." : "로그인"}
                </button>

                <p className={styles.footer}>
                    계정이 없으신가요? <Link to="/register">회원가입</Link>
                </p>
            </div>
        </div>
    );
}
