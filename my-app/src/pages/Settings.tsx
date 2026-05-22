import { useEffect, useState } from "react";
import { getMe } from "../api/auth";
import { updateMe, changePassword } from "../api/users";
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import styles from "./Settings.module.css";

export default function Settings() {
    const { showToast } = useToast();
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [birthDate, setBirthDate] = useState("");
    const [email, setEmail] = useState("");
    const [saving, setSaving] = useState(false);

    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [pwSaving, setPwSaving] = useState(false);

    const [gmailConnected, setGmailConnected] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);

    const [notifPerm, setNotifPerm] = useState<NotificationPermission | null>(null);

    useEffect(() => {
        if ("Notification" in window) setNotifPerm(Notification.permission);
    }, []);

    const handleRequestNotif = () => {
        Notification.requestPermission().then((perm) => {
            setNotifPerm(perm);
            if (perm === "granted") showToast("알림이 허용되었습니다.");
            else if (perm === "denied") showToast("알림이 차단되었습니다. 브라우저 설정에서 변경해주세요.", "error");
        });
    };

    useEffect(() => {
        getMe().then((data) => {
            setEmail(data.email);
            setName(data.name ?? "");
            setPhone(data.phone ?? "");
            setBirthDate(data.birth_date ?? "");
            setGmailConnected(!!data.gmail_access_token);
            // !! : truthy/falsy 값을 명시적으로 boolean으로 변환
        });
    }, []);

    const handleChangePassword = async () => {
        if (newPassword !== confirmPassword) {
            showToast("새 비밀번호가 일치하지 않습니다.", "error");
            return;
        }
        setPwSaving(true);
        try {
            await changePassword(currentPassword, newPassword);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            showToast("비밀번호가 변경되었습니다.");
        } catch (err: any) {
            showToast(err.response?.data?.detail ?? "변경에 실패했습니다.", "error");
        } finally {
            setPwSaving(false);
        }
    };

    const handleDisconnectGmail = async () => {
        if (!window.confirm("Gmail 연결을 해제할까요? 이메일 기능을 사용하려면 다시 연결해야 합니다.")) return;
        setDisconnecting(true);
        try {
            await api.delete("/auth/gmail");
            setGmailConnected(false);
            showToast("Gmail 연결이 해제되었습니다.");
        } catch {
            showToast("Gmail 연결 해제에 실패했습니다. 다시 시도해주세요.");
        } finally {
            setDisconnecting(false);
        }
    };

    const handleConnectGmail = async () => {
        const res = await api.get("/auth/gmail");
        window.location.href = res.data.url;
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateMe({ name, phone, birth_date: birthDate });
            showToast("저장되었습니다.");
        } catch {
            showToast("저장에 실패했습니다. 다시 시도해주세요.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={styles.container}>
            <h1 className={styles.pageTitle}>Settings</h1>

            <section className={styles.section}>
                <p className={styles.sectionLabel}>계정</p>
                <div className={styles.field}>
                    <label className={styles.label}>이메일</label>
                    <input className={styles.input} value={email} disabled />
                    {/* disabled : 이메일은 수정 불가 */}
                </div>
            </section>

            <section className={styles.section}>
                <p className={styles.sectionLabel}>프로필</p>
                <div className={styles.field}>
                    <label className={styles.label}>이름</label>
                    <input
                        className={styles.input}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
                <div className={styles.field}>
                    <label className={styles.label}>전화번호</label>
                    <input
                        className={styles.input}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                    />
                </div>
                <div className={styles.field}>
                    <label className={styles.label}>생년월일</label>
                    <input
                        className={styles.input}
                        type="date"
                        value={birthDate}
                        onChange={(e) => setBirthDate(e.target.value)}
                    />
                </div>
            </section>

            <div className={styles.actions}>
                <button className={styles.saveButton} onClick={handleSave} disabled={saving}>
                    {saving ? "저장 중..." : "저장"}
                </button>
            </div>

            <section className={styles.section}>
                <p className={styles.sectionLabel}>비밀번호 변경</p>
                <div className={styles.field}>
                    <label className={styles.label}>현재 비밀번호</label>
                    <input
                        className={styles.input}
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                </div>
                <div className={styles.field}>
                    <label className={styles.label}>새 비밀번호</label>
                    <input
                        className={styles.input}
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                    />
                </div>
                <div className={styles.field}>
                    <label className={styles.label}>새 비밀번호 확인</label>
                    <input
                        className={styles.input}
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleChangePassword(); }}
                    />
                </div>
                <div className={styles.actions}>
                    <button className={styles.saveButton} onClick={handleChangePassword} disabled={pwSaving}>
                        {pwSaving ? "변경 중..." : "변경"}
                    </button>
                </div>
            </section>

            <section className={styles.section}>
                <p className={styles.sectionLabel}>알림</p>
                <div className={styles.field}>
                    <label className={styles.label}>브라우저 알림</label>
                    <span className={styles.connectionStatus}>
                        {notifPerm === "granted" && "허용됨"}
                        {notifPerm === "denied" && "차단됨 (브라우저 설정에서 변경)"}
                        {notifPerm === "default" && "허용되지 않음"}
                        {notifPerm === null && "지원 안 됨"}
                    </span>
                    {notifPerm === "granted" ? (
                        <span className={styles.notifGranted}>사용 중</span>
                    ) : notifPerm === "default" ? (
                        <button className={styles.connectButton} onClick={handleRequestNotif}>
                            허용하기
                        </button>
                    ) : null}
                </div>
            </section>

            <section className={styles.section}>
                <p className={styles.sectionLabel}>연동</p>
                <div className={styles.field}>
                    <label className={styles.label}>Gmail</label>
                    <span className={styles.connectionStatus}>
                        {gmailConnected ? "연결됨" : "연결 안 됨"}
                    </span>
                    {gmailConnected ? (
                        <button
                            className={styles.disconnectButton}
                            onClick={handleDisconnectGmail}
                            disabled={disconnecting}
                        >
                            {disconnecting ? "해제 중..." : "연결 해제"}
                        </button>
                    ) : (
                        <button
                            className={styles.connectButton}
                            onClick={handleConnectGmail}
                        >
                            연결하기
                        </button>
                    )}
                </div>
            </section>
        </div>
    );
}
