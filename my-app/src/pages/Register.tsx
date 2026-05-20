import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { registerUser } from "../api/users";
import { warmUpServer } from "../api/client";
import { useToast } from "../context/ToastContext";
import styles from "./Auth.module.css";

export default function Register() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [birthDate, setBirthDate] = useState("");
    const [agreed, setAgreed] = useState(false); // agreed : 개인정보 동의 여부
    const [loading, setLoading] = useState(false);
    const { showToast } = useToast();

    useEffect(() => {
        warmUpServer();
    }, []);

    const handleRegister = async () => {
        if (!agreed) {
            showToast("개인정보 수집 및 이용에 동의해주세요.");
            return;
        }
        if (password.length < 8) {
            showToast("비밀번호는 8자 이상이어야 합니다.");
            return;
        }
        setLoading(true);
        try {
            await registerUser(email, password, name, phone, birthDate);
            window.location.href = "/login";
        } catch (error: any) {
            const msg = error?.response?.data?.detail;
            showToast(msg ?? "이미 사용 중인 이메일이거나 오류가 발생했습니다.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.page}>
            <div className={`${styles.card} ${styles.cardWide}`}>
                {/* ${styles.card} ${styles.cardWide} : 두 클래스를 동시에 적용 */}
                <p className={styles.title}>Neatly</p>

                <input
                    className={styles.input}
                    placeholder="이름"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
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
                />
                <input
                    className={styles.input}
                    placeholder="전화번호"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                />
                <input
                    className={styles.input}
                    type="date"
                    placeholder="생년월일"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                />

                <label className={styles.checkboxRow}>
                    <input
                        type="checkbox"
                        checked={agreed}
                        onChange={(e) => setAgreed(e.target.checked)}
                    />
                    개인정보 수집 및 이용에 동의합니다.
                </label>

                <button className={styles.button} onClick={handleRegister} disabled={loading}>
                    {loading ? "가입 중..." : "회원가입"}
                </button>

                <p className={styles.footer}>
                    이미 계정이 있으신가요? <Link to="/login">로그인</Link>
                </p>
            </div>
        </div>
    );
}
