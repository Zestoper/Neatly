import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createDocument } from "../api/documents";
import { getFolders } from "../api/folders";
import { useToast } from "../context/ToastContext";
import { useRefresh } from "../context/RefreshContext";
import styles from "./DocumentNew.module.css";

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
    { id: "h1",     label: "제목 1",       hint: "큰 제목",      insert: "# ",            lineStart: true, cursorOffset: 0  },
    { id: "h2",     label: "제목 2",       hint: "중간 제목",     insert: "## ",           lineStart: true, cursorOffset: 0  },
    { id: "h3",     label: "제목 3",       hint: "작은 제목",     insert: "### ",          lineStart: true, cursorOffset: 0  },
    { id: "ul",     label: "리스트",       hint: "불릿 목록",     insert: "- ",            lineStart: true, cursorOffset: 0  },
    { id: "ol",     label: "번호 리스트",  hint: "번호 목록",     insert: "1. ",           lineStart: true, cursorOffset: 0  },
    { id: "quote",  label: "인용",         hint: "인용구",        insert: "> ",            lineStart: true, cursorOffset: 0  },
    { id: "code",   label: "코드 블록",    hint: "코드",          insert: "```\n\n```",    lineStart: true, cursorOffset: -4 },
    { id: "hr",     label: "구분선",       hint: "수평선",        insert: "\n---\n",       lineStart: true, cursorOffset: 0  },
    { id: "toggle", label: "토글",         hint: "접기/펼치기",   insert: "^ 토글제목\n^ 내용\n", lineStart: true, cursorOffset: -6 },
] as const;

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

export default function DocumentNew() {
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { bump } = useRefresh();
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [saving, setSaving] = useState(false);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [folderId, setFolderId] = useState<string>("");
    const [slashMenu, setSlashMenu] = useState<SlashMenu | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        getFolders().then(setFolders);
    }, []);

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

    const slashFiltered = slashMenu
        ? MD_COMMANDS.filter(cmd =>
            slashMenu.query === '' || cmd.label.includes(slashMenu.query) || cmd.hint.includes(slashMenu.query)
          )
        : [];

    const handleSave = async () => {
        if (!title.trim()) {
            showToast("제목을 입력해주세요.", "error");
            return;
        }
        setSaving(true);
        try {
            await createDocument(title, content, folderId || null);
            showToast("문서가 저장되었습니다.");
            bump();
            navigate("/documents");
        } catch (error: any) {
            if (error.response?.status === 403) {
                showToast(error.response.data.detail, "error");
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={styles.container}>
            <input
                className={styles.titleInput}
                placeholder="제목 없음"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
                ref={textareaRef}
                className={styles.contentInput}
                placeholder="내용을 입력하세요... ( / 로 서식 추가)"
                value={content}
                onChange={handleContentChange}
                onKeyDown={handleTextareaKeyDown}
            />

            {slashMenu && slashFiltered.length > 0 && (
                <div
                    className={styles.slashMenu}
                    style={{ top: slashMenu.menuTop, left: slashMenu.menuLeft }}
                >
                    {slashFiltered.map((cmd, i) => (
                        <div
                            key={cmd.id}
                            className={i === slashMenu.activeIdx ? styles.slashMenuItemActive : styles.slashMenuItem}
                            onMouseDown={(e) => { e.preventDefault(); applyCommand(cmd); }}
                        >
                            <span className={styles.slashMenuLabel}>{cmd.label}</span>
                            <span className={styles.slashMenuHint}>{cmd.hint}</span>
                        </div>
                    ))}
                </div>
            )}

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

            <div className={styles.actions}>
                <button
                    className={styles.saveButton}
                    onClick={handleSave}
                    disabled={saving}
                >
                    {saving ? "저장 중..." : "저장"}
                </button>
                <button
                    className={styles.cancelButton}
                    onClick={() => navigate("/documents")}
                >
                    취소
                </button>
            </div>
        </div>
    );
}
