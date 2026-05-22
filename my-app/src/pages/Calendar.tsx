import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
    getEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    type CalendarEvent,
} from "../api/calendar";
import { getDocuments } from "../api/documents";
import { useToast } from "../context/ToastContext";
import styles from "./Calendar.module.css";

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

type Doc = { id: string; title: string };

function getDaysInMonth(year: number, month: number) {
    return new Date(year, month, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
    return new Date(year, month - 1, 1).getDay();
}

function toLocalDateString(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

type ModalState =
    | { mode: "create"; date: string }
    | { mode: "edit"; event: CalendarEvent }
    | null;

export default function Calendar() {
    const { showToast } = useToast();
    const today = new Date();

    const [year, setYear] = useState(today.getFullYear());
    const [month, setMonth] = useState(today.getMonth() + 1);
    const [notifPerm, setNotifPerm] = useState<NotificationPermission | null>(null);
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [docs, setDocs] = useState<Doc[]>([]);
    const [modal, setModal] = useState<ModalState>(null);

    const [formTitle, setFormTitle] = useState("");
    const [formDesc, setFormDesc] = useState("");
    const [formDate, setFormDate] = useState("");
    const [formTime, setFormTime] = useState("09:00");
    const [formDocId, setFormDocId] = useState<string>("");
    const [docSearch, setDocSearch] = useState("");
    const [saving, setSaving] = useState(false);

    const load = () => {
        getEvents(year, month).then(setEvents).catch(() => {});
    };

    useEffect(() => { load(); }, [year, month]);

    useEffect(() => {
        if (!("Notification" in window)) return;
        setNotifPerm(Notification.permission);
    }, []);

    const requestNotifPermission = () => {
        Notification.requestPermission().then((perm) => setNotifPerm(perm));
    };

    useEffect(() => {
        getDocuments()
            .then((data: Doc[]) => setDocs(data.filter((d) => d.title)))
            .catch(() => {});
    }, []);

    const filteredDocs = docSearch.trim()
        ? docs.filter((d) => d.title.toLowerCase().includes(docSearch.toLowerCase()))
        : docs;

    const openCreate = (date: string) => {
        setFormTitle("");
        setFormDesc("");
        setFormDate(date);
        setFormTime("09:00");
        setFormDocId("");
        setDocSearch("");
        setModal({ mode: "create", date });
    };

    const openEdit = (ev: CalendarEvent) => {
        const dt = new Date(ev.event_date);
        setFormTitle(ev.title);
        setFormDesc(ev.description ?? "");
        setFormDate(toLocalDateString(dt));
        setFormTime(`${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`);
        setFormDocId(ev.document_id ?? "");
        setDocSearch(ev.document?.title ?? "");
        setModal({ mode: "edit", event: ev });
    };

    const closeModal = () => setModal(null);

    const handleSave = async () => {
        if (!formTitle.trim()) return;
        setSaving(true);
        try {
            const isoDate = `${formDate}T${formTime}:00`;
            const docId = formDocId || null;
            if (modal?.mode === "create") {
                await createEvent(formTitle.trim(), isoDate, formDesc.trim() || undefined, docId);
                showToast("일정이 추가되었습니다.");
            } else if (modal?.mode === "edit") {
                await updateEvent(modal.event.id, {
                    title: formTitle.trim(),
                    description: formDesc.trim() || undefined,
                    event_date: isoDate,
                    document_id: docId,
                });
                showToast("일정이 수정되었습니다.");
            }
            closeModal();
            load();
        } catch {
            showToast("저장에 실패했습니다.", "error");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm("일정을 삭제할까요?")) return;
        try {
            await deleteEvent(id);
            showToast("일정이 삭제되었습니다.");
            closeModal();
            load();
        } catch {
            showToast("삭제에 실패했습니다.", "error");
        }
    };

    const prevMonth = () => {
        if (month === 1) { setYear(y => y - 1); setMonth(12); }
        else setMonth(m => m - 1);
    };

    const nextMonth = () => {
        if (month === 12) { setYear(y => y + 1); setMonth(1); }
        else setMonth(m => m + 1);
    };

    const daysInMonth = getDaysInMonth(year, month);
    const firstDow = getFirstDayOfWeek(year, month);
    const todayStr = toLocalDateString(today);

    const eventsByDate: Record<string, CalendarEvent[]> = {};
    for (const ev of events) {
        const key = toLocalDateString(new Date(ev.event_date));
        if (!eventsByDate[key]) eventsByDate[key] = [];
        eventsByDate[key].push(ev);
    }

    const cells: (number | null)[] = [
        ...Array(firstDow).fill(null),
        ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
    while (cells.length % 7 !== 0) cells.push(null);

    const editEvent = modal?.mode === "edit" ? modal.event : null;

    return (
        <div className={styles.container}>
            {notifPerm === "default" && (
                <div className={styles.notifBanner}>
                    일정 알림을 받으려면 알림 허용이 필요합니다.
                    <button className={styles.notifBannerBtn} onClick={requestNotifPermission}>
                        알림 허용
                    </button>
                </div>
            )}
            {notifPerm === "denied" && (
                <div className={styles.notifBannerDenied}>
                    브라우저 알림이 차단되어 있습니다. 브라우저 설정에서 허용해 주세요.
                </div>
            )}
            <div className={styles.header}>
                <button className={styles.navBtn} onClick={prevMonth}>&lt;</button>
                <h1 className={styles.title}>{year}년 {month}월</h1>
                <button className={styles.navBtn} onClick={nextMonth}>&gt;</button>
            </div>

            <div className={styles.grid}>
                {DAY_LABELS.map((d) => (
                    <div key={d} className={styles.dayLabel}>{d}</div>
                ))}
                {cells.map((day, idx) => {
                    if (day === null) {
                        return <div key={`empty-${idx}`} className={styles.cellEmpty} />;
                    }
                    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const isToday = dateStr === todayStr;
                    const dayEvents = eventsByDate[dateStr] ?? [];

                    return (
                        <div
                            key={dateStr}
                            className={isToday ? styles.cellToday : styles.cell}
                            onClick={() => openCreate(dateStr)}
                        >
                            <span className={styles.dayNum}>{day}</span>
                            <div className={styles.eventList}>
                                {dayEvents.map((ev) => (
                                    <button
                                        key={ev.id}
                                        className={ev.document_id ? styles.eventChipLinked : styles.eventChip}
                                        onClick={(e) => { e.stopPropagation(); openEdit(ev); }}
                                        title={ev.document ? ev.document.title : undefined}
                                    >
                                        {new Date(ev.event_date).toLocaleTimeString("ko-KR", {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                            hour12: false,
                                        })}{" "}
                                        {ev.title}
                                        {ev.document_id && <span className={styles.docDot} />}
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {modal && (
                <div className={styles.overlay} onClick={closeModal}>
                    <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
                        <h2 className={styles.modalTitle}>
                            {modal.mode === "create" ? "일정 추가" : "일정 수정"}
                        </h2>

                        <label className={styles.label}>제목</label>
                        <input
                            className={styles.input}
                            value={formTitle}
                            onChange={(e) => setFormTitle(e.target.value)}
                            placeholder="일정 제목"
                            autoFocus
                        />

                        <label className={styles.label}>날짜</label>
                        <input
                            className={styles.input}
                            type="date"
                            value={formDate}
                            onChange={(e) => setFormDate(e.target.value)}
                        />

                        <label className={styles.label}>시간</label>
                        <input
                            className={styles.input}
                            type="time"
                            value={formTime}
                            onChange={(e) => setFormTime(e.target.value)}
                        />

                        <label className={styles.label}>메모 (선택)</label>
                        <textarea
                            className={styles.textarea}
                            value={formDesc}
                            onChange={(e) => setFormDesc(e.target.value)}
                            placeholder="메모"
                            rows={2}
                        />

                        <label className={styles.label}>문서 연결 (선택)</label>
                        <div className={styles.docPicker}>
                            <input
                                className={styles.input}
                                value={docSearch}
                                onChange={(e) => {
                                    setDocSearch(e.target.value);
                                    if (!e.target.value) setFormDocId("");
                                }}
                                placeholder="문서 검색..."
                            />
                            {formDocId && (
                                <button
                                    className={styles.docClearBtn}
                                    onClick={() => { setFormDocId(""); setDocSearch(""); }}
                                    title="연결 해제"
                                >
                                    ✕
                                </button>
                            )}
                            {docSearch && !formDocId && filteredDocs.length > 0 && (
                                <ul className={styles.docDropdown}>
                                    {filteredDocs.slice(0, 8).map((d) => (
                                        <li
                                            key={d.id}
                                            className={styles.docDropdownItem}
                                            onClick={() => {
                                                setFormDocId(d.id);
                                                setDocSearch(d.title);
                                            }}
                                        >
                                            {d.title}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {/* 수정 모드에서 연결된 문서 바로가기 */}
                        {editEvent?.document && (
                            <Link
                                to={`/documents/${editEvent.document.id}`}
                                className={styles.docLink}
                                onClick={closeModal}
                            >
                                문서 열기: {editEvent.document.title}
                            </Link>
                        )}

                        <div className={styles.modalActions}>
                            {modal.mode === "edit" && (
                                <button
                                    className={styles.deleteBtn}
                                    onClick={() => handleDelete(editEvent!.id)}
                                >
                                    삭제
                                </button>
                            )}
                            <button className={styles.cancelBtn} onClick={closeModal}>취소</button>
                            <button
                                className={styles.saveBtn}
                                onClick={handleSave}
                                disabled={saving || !formTitle.trim()}
                            >
                                {saving ? "저장 중..." : "저장"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
