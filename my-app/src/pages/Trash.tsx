import { useEffect, useState } from "react";
import { getTrashDocuments, restoreDocument, permanentlyDeleteDocument, restoreGmailEmail } from "../api/documents";
import { useToast } from "../context/ToastContext";
import { useRefresh } from "../context/RefreshContext";
import ConfirmModal from "../components/ConfirmModal";
import styles from "./Trash.module.css";

type TrashDoc = {
    id: string;
    title: string;
    raw_text: string;
    raw_html: string | null;
    deleted_at: string;
};

export default function Trash() {
    const { showToast } = useToast();
    const { refreshKey, bump } = useRefresh();
    const [docs, setDocs] = useState<TrashDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);

    useEffect(() => {
        setLoading(true);
        getTrashDocuments()
            .then(setDocs)
            .finally(() => setLoading(false));
    }, [refreshKey]);

    const handleRestore = async (doc: TrashDoc, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            if (doc.raw_html) {
                const res = await restoreGmailEmail(doc.id);
                showToast(res.message ?? "Gmail로 복원되었습니다.");
            } else {
                await restoreDocument(doc.id);
                showToast("문서가 복원되었습니다.");
            }
            bump();
        } catch {
            showToast("복원에 실패했습니다. 다시 시도해주세요.");
        }
    };

    const handlePermanentDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setConfirmModal({
            message: "영구 삭제하면 복원할 수 없습니다. 계속할까요?",
            onConfirm: async () => {
                setConfirmModal(null);
                try {
                    await permanentlyDeleteDocument(id);
                    showToast("영구 삭제되었습니다.");
                    bump();
                } catch {
                    showToast("삭제에 실패했습니다. 다시 시도해주세요.");
                }
            },
        });
    };

    const formatDate = (iso: string) =>
        new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });

    if (loading) return <p>불러오는 중...</p>;

    return (
        <div className={styles.container}>
            <h1 className={styles.heading}>휴지통</h1>
            <p className={styles.subheading}>삭제된 문서는 여기서 복원하거나 영구 삭제할 수 있습니다.</p>

            {docs.length === 0 ? (
                <p className={styles.empty}>휴지통이 비어있습니다.</p>
            ) : (
                <div className={styles.list}>
                    {docs.map((doc) => (
                        <div key={doc.id} className={styles.row}>
                            <div className={styles.info}>
                                <p className={styles.title}>{doc.title}</p>
                                <p className={styles.meta}>
                                    {doc.deleted_at
                                        ? `${formatDate(doc.deleted_at)} 삭제됨`
                                        : ""}
                                </p>
                            </div>
                            <div className={styles.actions}>
                                <button
                                    className={styles.restoreButton}
                                    onClick={(e) => handleRestore(doc, e)}
                                >
                                    {doc.raw_html ? "Gmail로 복원" : "복원"}
                                </button>
                                <button
                                    className={styles.deleteButton}
                                    onClick={(e) => handlePermanentDelete(doc.id, e)}
                                >
                                    영구 삭제
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        {confirmModal && (
            <ConfirmModal
                message={confirmModal.message}
                confirmLabel="영구 삭제"
                danger
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal(null)}
            />
        )}
        </div>
    );
}
