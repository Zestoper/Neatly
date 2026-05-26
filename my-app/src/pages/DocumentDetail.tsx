import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { getDocument, updateDocument, deleteDocument, moveDocumentToFolder } from "../api/documents";
import { getFolders } from "../api/folders";
import { addTagToDocument, removeTagFromDocument } from "../api/tags";
import { useToast } from "../context/ToastContext";
import { useRefresh } from "../context/RefreshContext";
import AiChatFab from "../components/AiChatFab";
import ConfirmModal from "../components/ConfirmModal";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import styles from "./DocumentDetail.module.css";

const sanitizeSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"],
};

type Tag = {
    id: string;
    name: string;
};

type Document = {
    id: string;
    title: string;
    raw_text: string;
    raw_html: string | null;
    summary: string | null;
    folder_id: string | null;
    tags: Tag[];  // tags : 이 문서에 달린 태그 목록
};

type Folder = {
    id: string;
    name: string;
};

type SlashMenu = {
    query: string;
    activeIdx: number;
    slashPos: number;
    menuTop: number;
    menuLeft: number;
};

const MD_COMMANDS = [
    { id: "h1",    label: "제목 1",      hint: "큰 제목",    insert: "# ",         lineStart: true,  cursorOffset: 0  },
    { id: "h2",    label: "제목 2",      hint: "중간 제목",   insert: "## ",        lineStart: true,  cursorOffset: 0  },
    { id: "h3",    label: "제목 3",      hint: "작은 제목",   insert: "### ",       lineStart: true,  cursorOffset: 0  },
    { id: "ul",    label: "리스트",      hint: "불릿 목록",   insert: "- ",         lineStart: true,  cursorOffset: 0  },
    { id: "ol",    label: "번호 리스트", hint: "번호 목록",   insert: "1. ",        lineStart: true,  cursorOffset: 0  },
    { id: "quote", label: "인용",        hint: "인용구",      insert: "> ",         lineStart: true,  cursorOffset: 0  },
    { id: "code",  label: "코드 블록",   hint: "코드",        insert: "```\n\n```", lineStart: true,  cursorOffset: -4 },
    { id: "hr",     label: "구분선",  hint: "수평선",   insert: "\n---\n",                                              lineStart: true,  cursorOffset: 0   },
    { id: "toggle", label: "토글",    hint: "접기/펼치기", insert: "^ 토글제목\n^ 내용\n",                                    lineStart: true, cursorOffset: -6  },
] as const;

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function preprocessToggles(text: string): string {
    const lines = text.split('\n');
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
        if (lines[i].startsWith('^ ')) {
            const title = escapeHtml(lines[i].slice(2));
            const contentLines: string[] = [];
            i++;
            while (i < lines.length && lines[i].startsWith('^ ')) {
                contentLines.push(lines[i].slice(2));
                i++;
            }
            out.push(`<details><summary>${title}</summary>`);
            if (contentLines.length > 0) out.push('', ...contentLines, '');
            out.push('</details>');
        } else {
            out.push(lines[i]);
            i++;
        }
    }
    return out.join('\n');
}

function getCaretMenuPos(ta: HTMLTextAreaElement, slashPos: number) {
    const rect = ta.getBoundingClientRect();
    const before = ta.value.slice(0, slashPos);
    const lineCount = (before.match(/\n/g) ?? []).length;
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 27;
    const paddingTop = parseFloat(getComputedStyle(ta).paddingTop) || 0;
    return {
        menuTop: rect.top + paddingTop + (lineCount + 1) * lineHeight - ta.scrollTop,
        menuLeft: rect.left,
    };
}

export default function DocumentDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const fromFolder: string | null = (location.state as any)?.fromFolder ?? null;
    const { showToast } = useToast();
    const { bump } = useRefresh();
    const [doc, setDoc] = useState<Document | null>(null);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [folderId, setFolderId] = useState<string>("");
    const [folders, setFolders] = useState<Folder[]>([]);
    const [tags, setTags] = useState<Tag[]>([]);
    const [tagInput, setTagInput] = useState("");
    const [preview, setPreview] = useState(false);
    const [slashMenu, setSlashMenu] = useState<SlashMenu | null>(null);
    const [saving, setSaving] = useState(false);
    const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void; confirmLabel?: string } | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const handleSaveRef = useRef<() => Promise<void>>(async () => {});

    const applyCommand = (cmd: typeof MD_COMMANDS[number]) => {
        if (!textareaRef.current || !slashMenu) return;
        const ta = textareaRef.current;
        const before = content.slice(0, slashMenu.slashPos);
        const after = content.slice(ta.selectionStart);
        const lineStart = before.lastIndexOf('\n') + 1;
        const beforeLine = before.slice(0, lineStart);
        const lineContent = before.slice(lineStart);
        const newContent = beforeLine + cmd.insert + lineContent + after;
        const newCursor = beforeLine.length + cmd.insert.length + lineContent.length + cmd.cursorOffset;
        setContent(newContent);
        setSlashMenu(null);
        setTimeout(() => {
            ta.selectionStart = ta.selectionEnd = newCursor;
            ta.focus();
        }, 0);
    };

    const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        const cursor = e.target.selectionStart ?? val.length;
        setContent(val);
        if (slashMenu !== null) {
            if (cursor <= slashMenu.slashPos) { setSlashMenu(null); return; }
            const q = val.slice(slashMenu.slashPos + 1, cursor);
            if (q.includes(' ') || q.includes('\n')) setSlashMenu(null);
            else setSlashMenu(prev => prev ? { ...prev, query: q, activeIdx: 0 } : null);
            return;
        }
        if (val[cursor - 1] === '/') {
            const prev = val[cursor - 2];
            if (prev === undefined || prev === '\n' || prev === ' ') {
                const pos = getCaretMenuPos(e.target, cursor - 1);
                setSlashMenu({ query: '', activeIdx: 0, slashPos: cursor - 1, ...pos });
            }
        }
    };

    const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (!slashMenu) return;
        const filtered = MD_COMMANDS.filter(cmd =>
            slashMenu.query === '' || cmd.label.includes(slashMenu.query) || cmd.hint.includes(slashMenu.query)
        );
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSlashMenu(prev => prev ? { ...prev, activeIdx: Math.min(prev.activeIdx + 1, filtered.length - 1) } : null);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSlashMenu(prev => prev ? { ...prev, activeIdx: Math.max(prev.activeIdx - 1, 0) } : null);
        } else if (e.key === 'Enter') {
            const cmd = filtered[slashMenu.activeIdx];
            if (cmd) { e.preventDefault(); applyCommand(cmd); }
        } else if (e.key === 'Escape') {
            setSlashMenu(null);
        }
    };

    useEffect(() => {
        if (!editing) return;
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                handleSaveRef.current();
            } else if (e.key === 'Escape') {
                setEditing(false);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [editing]);

    useEffect(() => {
        if (!id) return;

        Promise.all([getDocument(id), getFolders()])
            // 문서 정보와 폴더 목록을 동시에 불러옴
            .then(([docData, folderData]) => {
                setDoc(docData);
                setTitle(docData.title);
                setContent(docData.raw_text);
                setFolderId(docData.folder_id ?? ""); // folder_id가 null이면 빈 문자열로 초기화
                setFolders(folderData);
                setTags(docData.tags ?? []);  // tags가 없으면 빈 배열로 초기화
            })
            .finally(() => setLoading(false));
    }, [id]);

    const backPath = fromFolder
        ? `/documents?folder=${fromFolder}`
        : (doc?.folder_id ? `/documents?folder=${doc.folder_id}` : "/documents");

    const handleDelete = () => {
        if (!id || !doc) return;
        if (fromFolder) {
            setConfirmModal({
                message: "이 문서를 폴더에서 제거할까요?",
                confirmLabel: "제거",
                onConfirm: async () => {
                    setConfirmModal(null);
                    await moveDocumentToFolder(id, null);
                    showToast("폴더에서 제거되었습니다.");
                    bump();
                    navigate(backPath);
                },
            });
        } else {
            setConfirmModal({
                message: "이 문서를 휴지통으로 이동할까요?",
                confirmLabel: "휴지통으로 이동",
                onConfirm: async () => {
                    setConfirmModal(null);
                    await deleteDocument(id);
                    showToast("문서가 휴지통으로 이동되었습니다.");
                    bump();
                    navigate(backPath);
                },
            });
        }
    };

    const handleAddTag = async () => {
        const name = tagInput.trim();
        if (!name || !id) return;
        setTagInput("");  // 입력창 먼저 비움 — 중복 호출 방지
        const newTag = await addTagToDocument(id, name);
        // 이미 같은 태그가 있으면 추가하지 않음
        setTags((prev) =>
            prev.find((t) => t.id === newTag.id) ? prev : [...prev, newTag]
        );
    };

    const handleRemoveTag = async (tagId: string) => {
        if (!id) return;
        await removeTagFromDocument(id, tagId);
        setTags((prev) => prev.filter((t) => t.id !== tagId));
        // filter : 제거한 태그를 제외하고 나머지만 남김
    };

    const handleSave = async () => {
        if (!id) return;
        setSaving(true);
        try {
            await updateDocument(id, title, content, folderId || null);
            setEditing(false);
            const updated = await getDocument(id);
            setDoc(updated);
            setFolderId(updated.folder_id ?? "");
            showToast("저장되었습니다.");
            bump();
        } finally {
            setSaving(false);
        }
    };
    handleSaveRef.current = handleSave;


    if (loading) return <p>불러오는 중...</p>;
    if (!doc) return <p>문서를 찾을 수 없습니다.</p>;

    const currentFolder = folders.find((f) => f.id === doc.folder_id);
    const slashFiltered = slashMenu
        ? MD_COMMANDS.filter(cmd =>
            slashMenu.query === '' || cmd.label.includes(slashMenu.query) || cmd.hint.includes(slashMenu.query)
          )
        : [];
    // find : 조건에 맞는 첫 번째 항목 반환, 없으면 undefined

    return (
        <div className={styles.container}>
            <button className={styles.backButton} onClick={() => navigate(backPath)}>
                뒤로
            </button>

            {editing ? (
                <div>
                    <input
                        className={styles.editTitle}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                    />
                    <div className={styles.editBodyWrap}>
                        <div className={styles.editBodyToolbar}>
                            <button
                                className={!preview ? styles.previewTabActive : styles.previewTab}
                                onClick={() => setPreview(false)}
                                type="button"
                            >
                                편집
                            </button>
                            <button
                                className={preview ? styles.previewTabActive : styles.previewTab}
                                onClick={() => setPreview(true)}
                                type="button"
                            >
                                미리보기
                            </button>
                        </div>
                        {preview ? (
                            <div className={styles.markdownBody}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}>{preprocessToggles(content)}</ReactMarkdown>
                            </div>
                        ) : (
                            <textarea
                                ref={textareaRef}
                                className={styles.editBody}
                                value={content}
                                onChange={handleContentChange}
                                onKeyDown={handleTextareaKeyDown}
                            />
                        )}
                        {!preview && (
                            <p className={styles.markdownHint}>/ 로 서식 추가</p>
                        )}
                    </div>

                    {slashMenu && slashFiltered.length > 0 && (
                        <div
                            className={styles.slashMenu}
                            style={{ top: slashMenu.menuTop, left: slashMenu.menuLeft }}
                        >
                            {slashFiltered.map((cmd, i) => (
                                <div
                                    key={cmd.id}
                                    className={slashMenu.activeIdx === i ? styles.slashMenuItemActive : styles.slashMenuItem}
                                    onMouseDown={(e) => { e.preventDefault(); applyCommand(cmd); }}
                                >
                                    <span className={styles.slashMenuLabel}>{cmd.label}</span>
                                    <span className={styles.slashMenuHint}>{cmd.hint}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* 폴더가 하나라도 있을 때만 드롭다운 표시 */}
                    {folders.length > 0 && (
                        <select
                            className={styles.folderSelect}
                            value={folderId}
                            onChange={(e) => setFolderId(e.target.value)}
                        >
                            <option value="">폴더 선택 안 함</option>
                            {folders.map((f) => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                    )}

                    {/* 수정 모드 태그 영역 */}
                    <div className={styles.tagEditor}>
                        {/* 현재 달린 태그 — X 버튼으로 제거 */}
                        <div className={styles.tagList}>
                            {tags.map((tag) => (
                                <span key={tag.id} className={styles.tagBadge}>
                                    {tag.name}
                                    <button
                                        className={styles.tagRemoveBtn}
                                        onClick={() => handleRemoveTag(tag.id)}
                                    >
                                        ×
                                    </button>
                                </span>
                            ))}
                        </div>
                        {/* 태그 입력창 — Enter로 추가 */}
                        <input
                            className={styles.tagInput}
                            placeholder="태그 추가 후 Enter"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault(); // Enter가 폼 제출로 이어지지 않도록
                                    handleAddTag();
                                }
                            }}
                        />
                    </div>

                    <div className={styles.actions}>
                        <button className={styles.saveButton} onClick={handleSave} disabled={saving}>{saving ? "저장 중..." : "저장"}</button>
                        <button className={styles.cancelButton} onClick={() => setEditing(false)}>취소</button>
                    </div>
                </div>
            ) : (
                <div>
                    {/* 현재 폴더 이름 — 폴더에 속해있을 때만 표시 */}
                    {currentFolder && (
                        <p className={styles.folderBadge}>{currentFolder.name}</p>
                    )}

                    <h1 className={styles.title}>{doc.title}</h1>

                    {/* 읽기 모드 태그 목록 — 태그가 하나라도 있을 때만 렌더링 */}
                    {tags.length > 0 && (
                        <div className={styles.tagReadList}>
                            {tags.map((tag) => (
                                // key : React 리스트 렌더링에서 각 항목을 구분하는 고유값
                                <span key={tag.id} className={styles.tagBadge}>
                                    {tag.name}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* summary가 있을 때만 표시 — FREE 플랜은 흐림 처리 + 업그레이드 유도 */}
                    {doc.summary && (() => {
                        // isFree : 유료 플랜(STANDARD, PREMIUM)이 확인된 경우만 false — null이면 FREE로 취급
                        const plan = localStorage.getItem("plan");
                        const isFree = plan !== "STANDARD" && plan !== "PREMIUM";
                        return (
                            <div className={styles.summaryBox}>
                                <p className={styles.summaryLabel}>AI 요약</p>
                                {/* isFree면 흐린 텍스트, 아니면 일반 텍스트 */}
                                <p className={isFree ? styles.summaryTextBlurred : styles.summaryText}>
                                    {doc.summary}
                                </p>
                                {/* FREE 플랜일 때만 오버레이 렌더링 */}
                                {isFree && (
                                    <div className={styles.summaryOverlay}>
                                        <p className={styles.summaryOverlayText}>
                                            AI 요약은 Standard 플랜부터 사용할 수 있어요.
                                        </p>
                                        <button
                                            className={styles.upgradeButton}
                                            onClick={() => navigate("/plans")}
                                            // /plans : 플랜 선택 페이지로 이동
                                        >
                                            업그레이드
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* raw_html이 있으면 이메일 원본을 iframe으로 먼저 렌더링 */}
                    {doc.raw_html && (
                        <iframe
                            className={styles.emailFrame}
                            srcDoc={doc.raw_html}
                            // srcDoc : iframe 안에 HTML 문자열을 직접 넣음
                            // 부모 페이지 CSS가 영향을 주지 않아 이메일 레이아웃이 그대로 보존됨
                            sandbox="allow-same-origin"
                            // allow-same-origin만 허용 — 이미지 로딩은 가능, JS 실행은 차단
                        />
                    )}

                    {/* 본문 — 이메일이 아닌 문서는 마크다운으로 렌더링 */}
                    {!doc.raw_html && (
                        <div className={styles.markdownBody}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}>{preprocessToggles(doc.raw_text)}</ReactMarkdown>
                        </div>
                    )}
                    {/* 이메일 문서는 plain text로 표시 (이메일 HTML이 이미 iframe으로 렌더링됨) */}
                    {doc.raw_html && (
                        <p className={styles.body}>{doc.raw_text}</p>
                    )}

                    <div className={styles.actions}>
                        <button className={styles.editButton} onClick={() => setEditing(true)}>수정</button>
                        <button className={styles.deleteButton} onClick={handleDelete}>삭제</button>
                        <select
                            className={styles.folderSelect}
                            value={doc.folder_id ?? ""}
                            onChange={async (e) => {
                                const newFolderId = e.target.value || null;
                                await moveDocumentToFolder(id!, newFolderId);
                                bump();
                                navigate(newFolderId ? `/documents?folder=${newFolderId}` : "/documents");
                            }}
                        >
                            <option value="">폴더 없음</option>
                            {folders.map((f) => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            {/* AI 질문 FAB — 읽기 모드일 때만 */}
            {!editing && <AiChatFab documentId={id} />}

            {confirmModal && (
                <ConfirmModal
                    message={confirmModal.message}
                    confirmLabel={confirmModal.confirmLabel ?? "확인"}
                    danger
                    onConfirm={confirmModal.onConfirm}
                    onCancel={() => setConfirmModal(null)}
                />
            )}
        </div>
    );
}
