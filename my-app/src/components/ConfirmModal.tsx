import { useEffect } from "react";
import styles from "./ConfirmModal.module.css";

type Props = {
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
};

export default function ConfirmModal({
    message,
    confirmLabel = "확인",
    cancelLabel = "취소",
    danger = false,
    onConfirm,
    onCancel,
}: Props) {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter") onConfirm();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onConfirm, onCancel]);

    return (
        <div className={styles.overlay} onClick={onCancel}>
            <div className={styles.box} onClick={(e) => e.stopPropagation()}>
                <p className={styles.message}>{message}</p>
                <div className={styles.actions}>
                    <button className={styles.cancelBtn} onClick={onCancel}>
                        {cancelLabel}
                    </button>
                    <button
                        className={danger ? styles.dangerBtn : styles.confirmBtn}
                        onClick={onConfirm}
                        autoFocus
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
