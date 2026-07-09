import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { getFolders, createFolder, updateFolder, deleteFolder } from "../api/folders";
import { getEmailFilters, createEmailFilter, deleteEmailFilter } from "../api/emailFilters";
import type { EmailFilter } from "../api/emailFilters";
import { moveDocumentToFolder } from "../api/documents";
import { getSyncStatus } from "../api/emailSync";
import { api } from "../api/client";
import { useRefresh } from "../context/RefreshContext";
import { useToast } from "../context/ToastContext";
import ConfirmModal from "./ConfirmModal";
import styles from "./Sidebar.module.css";

type Folder = {
    id: string;
    name: string;
    folder_type: "document" | "email";
};

type SidebarProps = {
    isOpen: boolean;
    onToggle: () => void;
};

export default function Sidebar({ isOpen, onToggle }: SidebarProps) {
    const navigate = useNavigate();
    const { pathname } = useLocation();

    const navClass = (target: string) =>
        pathname === target ? styles.navItemActive : styles.navItem;

    const [folders, setFolders] = useState<Folder[]>([]);
    const [adding, setAdding] = useState(false);
    const [newName, setNewName] = useState("");

    const [emailFolders, setEmailFolders] = useState<Folder[]>([]);
    const [addingEmailFolder, setAddingEmailFolder] = useState(false);
    const [newEmailFolderName, setNewEmailFolderName] = useState("");

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");

    const [filters, setFilters] = useState<EmailFilter[]>([]);
    const [addingFilter, setAddingFilter] = useState(false);
    const [filterEmail, setFilterEmail] = useState("");

    const isPremium = localStorage.getItem("plan") === "PREMIUM";
    const { refreshKey, bump } = useRefresh();
    const { showToast } = useToast();

    const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);

    const [newEmailCount, setNewEmailCount] = useState(0);

    useEffect(() => {
        if (!isPremium) return;
        const fetchCount = () => {
            if (document.visibilityState === "hidden") return;
            getSyncStatus()
                .then((data) => setNewEmailCount(data.new_count ?? 0))
                .catch(() => {});
        };
        fetchCount();
        const timer = setInterval(fetchCount, 5 * 60 * 1000);
        document.addEventListener("visibilitychange", fetchCount);
        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", fetchCount);
        };
    }, [isPremium]);

    const [filterDragOver, setFilterDragOver] = useState(false);
    const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
    const [dragOverEmailFolderId, setDragOverEmailFolderId] = useState<string | null>(null);

    const [reorderDragId, setReorderDragId] = useState<string | null>(null);
    const [reorderDragOverId, setReorderDragOverId] = useState<string | null>(null);

    const applyOrder = (data: Folder[], key: string) => {

        const saved: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
        if (!saved.length) return data;
        return [...data].sort((a, b) => {
            const ai = saved.indexOf(a.id);
            const bi = saved.indexOf(b.id);
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        });
    };

    useEffect(() => {
        getFolders("document").then((data) => setFolders(applyOrder(data, "folderOrder")));
        getFolders("email").then((data) => setEmailFolders(applyOrder(data, "emailFolderOrder")));
        if (isPremium) getEmailFilters().then(setFilters);
    }, [refreshKey]);

    const handleAddFolder = async () => {
        const name = newName.trim();
        if (!name) return;
        setNewName("");
        setAdding(false);
        try {
            await createFolder(name, "document");
            bump();
        } catch {
            showToast("폴더 생성에 실패했습니다.");
        }
    };

    const handleAddEmailFolder = async () => {
        const name = newEmailFolderName.trim();
        if (!name) return;
        setNewEmailFolderName("");
        setAddingEmailFolder(false);
        try {
            await createFolder(name, "email");
            bump();
        } catch {
            showToast("폴더 생성에 실패했습니다.");
        }
    };

    const handleStartEdit = (folder: Folder) => {
        setEditingId(folder.id);
        setEditName(folder.name);
    };

    const handleUpdateFolder = async (id: string) => {
        const name = editName.trim();
        if (!name) return;
        setEditingId(null);
        try {
            await updateFolder(id, name);
            bump();
        } catch {
            showToast("폴더 이름 수정에 실패했습니다.");
        }
    };

    const handleDeleteFolder = (id: string) => {
        setConfirmModal({
            message: "폴더를 삭제할까요?",
            onConfirm: async () => {
                setConfirmModal(null);
                try {
                    await deleteFolder(id);
                    bump();
                } catch {
                    showToast("폴더 삭제에 실패했습니다.");
                }
            },
        });
    };

    const handleAddFilter = async () => {
        const sender = filterEmail.trim();
        if (!sender) return;
        setFilterEmail("");
        setAddingFilter(false);
        try {
            await createEmailFilter(sender);
            bump();
        } catch {
            showToast("필터 추가에 실패했습니다.");
        }
    };

    const handleDeleteFilter = async (id: string) => {
        try {
            await deleteEmailFilter(id);
            bump();
        } catch {
            showToast("필터 삭제에 실패했습니다.");
        }
    };

    const handleReorder = (draggedId: string, targetId: string) => {
        if (draggedId === targetId) return;
        const next = [...folders];
        const from = next.findIndex((f) => f.id === draggedId);
        const to   = next.findIndex((f) => f.id === targetId);
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        setFolders(next);
        localStorage.setItem("folderOrder", JSON.stringify(next.map((f) => f.id)));
    };

    const handleEmailReorder = (draggedId: string, targetId: string) => {
        if (draggedId === targetId) return;
        const next = [...emailFolders];
        const from = next.findIndex((f) => f.id === draggedId);
        const to   = next.findIndex((f) => f.id === targetId);
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        setEmailFolders(next);
        localStorage.setItem("emailFolderOrder", JSON.stringify(next.map((f) => f.id)));
    };

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("plan");
        navigate("/login");
    };

    return (
        <div className={isOpen ? styles.sidebar : styles.sidebarCollapsed}>

            <div className={styles.sidebarHeader}>
                <button className={styles.toggleButton} onClick={onToggle}>
                    ☰
                </button>
                {isOpen && <Link to="/" className={styles.logo}>Neatly</Link>}
            </div>

            {isOpen && (
            <>
            <button
                className={styles.newDocButton}
                onClick={() => navigate("/documents/new")}
            >
                New Document
            </button>

            <nav className={styles.nav}>
                <Link to="/" className={navClass("/")}>Dashboard</Link>
                <Link to="/calendar" className={navClass("/calendar")}>Calendar</Link>
                <Link to="/search" className={navClass("/search")}>Search</Link>
                <Link to="/documents" className={navClass("/documents")}>Documents</Link>

                {folders.map((folder) =>
                    editingId === folder.id ? (

                        <div key={folder.id} className={styles.folderInput}>
                            <input
                                autoFocus
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleUpdateFolder(folder.id);
                                    if (e.key === "Escape") setEditingId(null);
                                }}
                            />
                        </div>
                    ) : (

                        <div
                            key={folder.id}
                            className={
                                reorderDragOverId === folder.id
                                    ? styles.folderRowReorderOver
                                    : dragOverFolderId === folder.id
                                    ? styles.folderRowDragOver
                                    : styles.folderRow
                            }
                            onDragOver={(e) => {
                                e.preventDefault();
                                if (reorderDragId) {

                                    setReorderDragOverId(folder.id);
                                } else {

                                    setDragOverFolderId(folder.id);
                                }
                            }}
                            onDragLeave={() => {
                                setDragOverFolderId(null);
                                setReorderDragOverId(null);
                            }}
                            onDrop={async (e) => {
                                e.preventDefault();
                                setDragOverFolderId(null);
                                setReorderDragOverId(null);
                                const data = e.dataTransfer.getData("text/plain").trim();
                                if (!data) return;

                                if (data.startsWith("folder-reorder:")) {

                                    const draggedId = data.slice("folder-reorder:".length);
                                    handleReorder(draggedId, folder.id);
                                } else if (data.startsWith("email:")) {

                                    const emailId = data.slice("email:".length);
                                    await api.post(
                                        `/emails/${emailId}/to-document`,
                                        null,
                                        { params: { folder_id: folder.id } },
                                    );
                                } else {

                                    await moveDocumentToFolder(data, folder.id);
                                }
                            }}
                        >

                            <div
                                className={styles.dragHandle}
                                draggable
                                onDragStart={(e) => {
                                    e.stopPropagation();
                                    setReorderDragId(folder.id);
                                    e.dataTransfer.setData("text/plain", `folder-reorder:${folder.id}`);
                                    e.dataTransfer.effectAllowed = "move";
                                }}
                                onDragEnd={() => {
                                    setReorderDragId(null);
                                    setReorderDragOverId(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                &#9776;
                            </div>
                            <Link
                                to={`/documents?folder=${folder.id}`}
                                className={styles.folderItem}
                            >
                                {folder.name}
                            </Link>
                            <div className={styles.folderActions}>
                                <button
                                    className={styles.folderActionBtn}
                                    onClick={() => handleStartEdit(folder)}
                                    title="이름 수정"
                                >
                                    ✎
                                </button>
                                <button
                                    className={styles.folderActionBtn}
                                    onClick={() => handleDeleteFolder(folder.id)}
                                    title="삭제"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                    )
                )}

                {adding ? (
                    <div className={styles.folderInput}>
                        <input
                            autoFocus
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleAddFolder();
                                if (e.key === "Escape") setAdding(false);
                            }}
                            onBlur={() => { setAdding(false); setNewName(""); }}
                            placeholder="폴더 이름"
                        />
                    </div>
                ) : (
                    <button
                        className={styles.addFolderButton}
                        onClick={() => setAdding(true)}
                    >
                        + 폴더 추가
                    </button>
                )}

                <Link to="/emails" className={navClass("/emails")}>
                    Emails
                    {newEmailCount > 0 && (
                        <span className={styles.badge}>{newEmailCount}</span>
                    )}
                </Link>

                <p className={styles.sectionLabel}>폴더</p>
                {emailFolders.map((folder) =>
                    editingId === folder.id ? (

                        <div key={`ef-${folder.id}`} className={styles.folderInput}>
                            <input
                                autoFocus
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleUpdateFolder(folder.id);
                                    if (e.key === "Escape") setEditingId(null);
                                }}
                            />
                        </div>
                    ) : (
                        <div
                            key={`ef-${folder.id}`}
                            className={
                                reorderDragOverId === `ef-${folder.id}`
                                    ? styles.folderRowReorderOver
                                    : dragOverEmailFolderId === folder.id
                                    ? styles.folderRowDragOver
                                    : styles.folderRow
                            }
                            onDragOver={(e) => {
                                e.preventDefault();
                                if (reorderDragId) {
                                    setReorderDragOverId(`ef-${folder.id}`);
                                } else {
                                    setDragOverEmailFolderId(folder.id);
                                }
                            }}
                            onDragLeave={() => {
                                setDragOverEmailFolderId(null);
                                setReorderDragOverId(null);
                            }}
                            onDrop={async (e) => {
                                e.preventDefault();
                                setDragOverEmailFolderId(null);
                                setReorderDragOverId(null);
                                const data = e.dataTransfer.getData("text/plain").trim();
                                if (!data) return;
                                if (data.startsWith("email-folder-reorder:")) {
                                    handleEmailReorder(data.slice("email-folder-reorder:".length), folder.id);
                                } else if (data.startsWith("email:")) {
                                    const emailId = data.slice("email:".length);
                                    await api.post(`/emails/${emailId}/to-document`, null, {
                                        params: { folder_id: folder.id },
                                    });
                                } else if (!data.startsWith("folder-reorder:")) {
                                    await moveDocumentToFolder(data, folder.id);
                                }
                            }}
                        >

                            <div
                                className={styles.dragHandle}
                                draggable
                                onDragStart={(e) => {
                                    e.stopPropagation();
                                    setReorderDragId(folder.id);
                                    e.dataTransfer.setData("text/plain", `email-folder-reorder:${folder.id}`);
                                    e.dataTransfer.effectAllowed = "move";
                                }}
                                onDragEnd={() => {
                                    setReorderDragId(null);
                                    setReorderDragOverId(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                &#9776;
                            </div>
                            <Link
                                to={`/emails?folder=${folder.id}`}
                                className={styles.folderItem}
                            >
                                {folder.name}
                            </Link>
                            <div className={styles.folderActions}>
                                <button
                                    className={styles.folderActionBtn}
                                    onClick={() => handleStartEdit(folder)}
                                    title="이름 수정"
                                >
                                    ✎
                                </button>
                                <button
                                    className={styles.folderActionBtn}
                                    onClick={() => handleDeleteFolder(folder.id)}
                                    title="삭제"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                    )
                )}
                {addingEmailFolder ? (
                    <div className={styles.folderInput}>
                        <input
                            autoFocus
                            value={newEmailFolderName}
                            onChange={(e) => setNewEmailFolderName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleAddEmailFolder();
                                if (e.key === "Escape") {
                                    setAddingEmailFolder(false);
                                    setNewEmailFolderName("");
                                }
                            }}
                            onBlur={() => { setAddingEmailFolder(false); setNewEmailFolderName(""); }}
                            placeholder="폴더 이름"
                        />
                    </div>
                ) : (
                    <button
                        className={styles.addFolderButton}
                        onClick={() => setAddingEmailFolder(true)}
                    >
                        + 폴더 추가
                    </button>
                )}

                {isPremium && (
                    <p className={styles.sectionLabel}>필터</p>
                )}
                {isPremium && (
                    <div
                        className={filterDragOver ? styles.filterDropZoneActive : styles.filterDropZone}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setFilterDragOver(true);
                        }}
                        onDragLeave={() => setFilterDragOver(false)}
                        onDrop={async (e) => {
                            e.preventDefault();
                            setFilterDragOver(false);
                            const text = e.dataTransfer.getData("text/plain").trim();
                            if (!text) return;

                            const newFilter = await createEmailFilter(text);
                            setFilters((prev) =>
                                prev.find((f) => f.id === newFilter.id) ? prev : [...prev, newFilter]
                            );
                        }}
                    >
                        {filters.map((f) => (
                            <div key={f.id} className={styles.folderRow}>
                                <Link
                                    to={`/emails?sender=${encodeURIComponent(f.sender)}`}
                                    className={styles.folderItem}
                                >

                                    <span>{f.name ?? f.sender}</span>
                                    {f.name && (
                                        <span className={styles.filterEmail}>{f.sender}</span>
                                    )}
                                </Link>
                                <div className={styles.folderActions}>
                                    <button
                                        className={styles.folderActionBtn}
                                        onClick={() => handleDeleteFilter(f.id)}
                                        title="삭제"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        ))}

                        {addingFilter ? (
                            <div className={styles.folderInput}>
                                <input
                                    autoFocus
                                    value={filterEmail}
                                    onChange={(e) => setFilterEmail(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") handleAddFilter();
                                        if (e.key === "Escape") {
                                            setAddingFilter(false);
                                            setFilterEmail("");
                                        }
                                    }}
                                    onBlur={() => { setAddingFilter(false); setFilterEmail(""); }}
                                    placeholder="이메일 주소"
                                />
                            </div>
                        ) : (
                            <button
                                className={styles.addFolderButton}
                                onClick={() => setAddingFilter(true)}
                            >
                                + 필터 추가
                            </button>
                        )}
                    </div>
                )}

                <Link to="/emails?label=SPAM" className={styles.navSubItem}>
                    스팸
                </Link>

                <Link to="/insights" className={navClass("/insights")}>Insights</Link>
                <Link to="/plans" className={navClass("/plans")}>Plans</Link>
                <Link to="/trash" className={navClass("/trash")}>휴지통</Link>
                <Link to="/settings" className={navClass("/settings")}>Settings</Link>
            </nav>

            <div className={styles.bottom}>
                <button className={styles.logoutButton} onClick={handleLogout}>
                    로그아웃
                </button>
            </div>
            </>
            )}
        {confirmModal && (
            <ConfirmModal
                message={confirmModal.message}
                confirmLabel="삭제"
                danger
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal(null)}
            />
        )}
        </div>
    );
}
