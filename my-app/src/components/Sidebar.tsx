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
import styles from "./Sidebar.module.css";

type Folder = {
    id: string;
    name: string;
    folder_type: "document" | "email";
};

type SidebarProps = {
    isOpen: boolean;      // isOpen : true면 펼침, false면 접힘
    onToggle: () => void; // onToggle : 햄버거 버튼 클릭 시 호출
};

export default function Sidebar({ isOpen, onToggle }: SidebarProps) {
    const navigate = useNavigate();
    const { pathname } = useLocation();

    // 현재 경로가 target과 일치하면 활성 스타일 클래스 반환
    const navClass = (target: string) =>
        pathname === target ? styles.navItemActive : styles.navItem;
    // folders : Documents 섹션 전용 폴더 목록 (folder_type = "document")
    const [folders, setFolders] = useState<Folder[]>([]);
    const [adding, setAdding] = useState(false);
    const [newName, setNewName] = useState("");

    // emailFolders : Emails 섹션 전용 폴더 목록 (folder_type = "email")
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

    const [newEmailCount, setNewEmailCount] = useState(0);
    // newEmailCount : 마지막으로 Emails 페이지를 열었던 이후 자동 동기화로 추가된 새 문서 수

    // Premium이면 5분마다 새 이메일 뱃지 카운트 갱신
    useEffect(() => {
        if (!isPremium) return;
        const fetchCount = () => {
            getSyncStatus()
                .then((data) => setNewEmailCount(data.new_count ?? 0))
                .catch(() => {});
        };
        fetchCount();
        const timer = setInterval(fetchCount, 5 * 60 * 1000); // 5분마다 갱신
        return () => clearInterval(timer);
    }, [isPremium]);

    const [filterDragOver, setFilterDragOver] = useState(false);
    const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
    const [dragOverEmailFolderId, setDragOverEmailFolderId] = useState<string | null>(null);

    const [reorderDragId, setReorderDragId] = useState<string | null>(null);
    const [reorderDragOverId, setReorderDragOverId] = useState<string | null>(null);

    const applyOrder = (data: Folder[], key: string) => {
        // localStorage에 저장된 순서가 있으면 그 순서대로 정렬
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

    const handleDeleteFolder = async (id: string) => {
        if (!window.confirm("폴더를 삭제할까요?")) return;
        try {
            await deleteFolder(id);
            bump();
        } catch {
            showToast("폴더 삭제에 실패했습니다.");
        }
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

    // Documents 폴더 순서 변경
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

    // Emails 폴더 순서 변경 — 별도 localStorage 키 사용
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
        localStorage.removeItem("token"); // token 삭제 → 로그아웃 처리
        localStorage.removeItem("plan");  // plan 삭제
        navigate("/login");
    };

    return (
        <div className={isOpen ? styles.sidebar : styles.sidebarCollapsed}>
            {/* 상단 헤더 — 로고와 햄버거 버튼 */}
            <div className={styles.sidebarHeader}>
                {isOpen && <Link to="/" className={styles.logo}>Neatly</Link>}
                <button className={styles.toggleButton} onClick={onToggle}>
                    ☰
                </button>
            </div>

            {/* isOpen일 때만 나머지 내용 렌더링 */}
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

                {/* 폴더 목록 */}
                {folders.map((folder) =>
                    editingId === folder.id ? (
                        // 수정 모드 — 인라인 입력창
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
                        // 읽기 모드 — 이름 + 수정·삭제 버튼
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
                                    // 폴더 순서 변경 드래그 — 드롭 위치 강조
                                    setReorderDragOverId(folder.id);
                                } else {
                                    // 문서/이메일 드래그 — 폴더 강조
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
                                    // 폴더 순서 변경 드래그 — 드롭 위치로 이동
                                    const draggedId = data.slice("folder-reorder:".length);
                                    handleReorder(draggedId, folder.id);
                                } else if (data.startsWith("email:")) {
                                    // 이메일 드래그 — AI 요약 후 해당 폴더에 문서로 저장
                                    const emailId = data.slice("email:".length);
                                    await api.post(
                                        `/emails/${emailId}/to-document`,
                                        null,
                                        { params: { folder_id: folder.id } },
                                    );
                                } else {
                                    // 문서 드래그 — 폴더만 이동
                                    await moveDocumentToFolder(data, folder.id);
                                }
                            }}
                        >
                            {/* 드래그 핸들 — 호버 시 표시, 클릭해서 드래그하면 순서 변경 */}
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

                {/* adding이 true면 입력창, false면 추가 버튼 */}
                {adding ? (
                    <div className={styles.folderInput}>
                        <input
                            autoFocus
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleAddFolder();   // Enter : 저장
                                if (e.key === "Escape") setAdding(false);  // Escape : 취소
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

                {/* Emails 아래 폴더 목록 — folder_type이 "email"인 폴더만 표시 */}
                <p className={styles.sectionLabel}>폴더</p>
                {emailFolders.map((folder) =>
                    editingId === folder.id ? (
                        // 수정 모드 — 인라인 입력창
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
                            {/* 드래그 핸들 — 이메일 폴더 순서 변경 */}
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

                {/* Premium 플랜일 때만 이메일 필터 목록 표시 */}
                {isPremium && (
                    <p className={styles.sectionLabel}>필터</p>
                )}
                {isPremium && (
                    <div
                        className={filterDragOver ? styles.filterDropZoneActive : styles.filterDropZone}
                        onDragOver={(e) => {
                            e.preventDefault(); // 드롭 허용 — 이게 없으면 onDrop이 발동 안 됨
                            setFilterDragOver(true);
                        }}
                        onDragLeave={() => setFilterDragOver(false)}
                        onDrop={async (e) => {
                            e.preventDefault();
                            setFilterDragOver(false);
                            const text = e.dataTransfer.getData("text/plain").trim();
                            if (!text) return;
                            // 드롭된 텍스트로 필터 생성 — 이미 있으면 서버가 기존 것을 반환
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
                                    {/* 이름이 있으면 이름 표시, 없으면 이메일 주소 표시 */}
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
                {/* 스팸 링크 — 모든 플랜에서 접근 가능 */}
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
        </div>
    );
}
