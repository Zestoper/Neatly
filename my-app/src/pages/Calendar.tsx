import { useEffect, useState } from "react";
import {
    getEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    type CalendarEvent,
} from "../api/calendar";
import { useToast } from "../context/ToastContext";
import styles from "./Calendar.module.css";

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

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
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [modal, setModal] = useState<ModalState>(null);

    const [formTitle, setFormTitle] = useState("");
    const [formDesc, setFormDesc] = useState("");
    const [formDate, setFormDate] = useState("");
    const [formTime, setFormTime] = useState("09:00");
    const [saving, setSaving] = useState(false);

    const load = () => {
        getEvents(year, month).then(setEvents).catch(() => {});
    };

    useEffect(() => { load(); }, [year, month]);

    const openCreate = (date: string) => {
        setFormTitle("");
        setFormDesc("");
        setFormDate(date);
        setFormTime("09:00");
        setModal({ mode: "create", date });
    };

    const openEdit = (ev: CalendarEvent) => {
        const dt = new Date(ev.event_date);
        setFormTitle(ev.title);
        setFormDesc(ev.description ?? "");
        setFormDate(toLocalDateString(dt));
        setFormTime(`${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`);
        setModal({ mode: "edit", event: ev });
    };

    const closeModal = () => setModal(null);

    const handleSave = async () => {
        if (!formTitle.trim()) return;
        setSaving(true);
        try {
            const isoDate = `${formDate}T${formTime}:00`;
            if (modal?.mode === "create") {
                await createEvent(formTitle.trim(), isoDate, formDesc.trim() || undefined);
                showToast("일정이 추가되었습니다.");
            } else if (modal?.mode === "edit") {
                await updateEvent(modal.event.id, {
                    title: formTitle.trim(),
                    description: formDesc.trim() || undefined,
                    event_date: isoDate,
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

    return (
        <div className={styles.container}>
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
                                        className={styles.eventChip}
                                        onClick={(e) => { e.stopPropagation(); openEdit(ev); }}
                                    >
                                        {new Date(ev.event_date).toLocaleTimeString("ko-KR", {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                            hour12: false,
                                        })}{" "}
                                        {ev.title}
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
                            rows={3}
                        />

                        <div className={styles.modalActions}>
                            {modal.mode === "edit" && (
                                <button
                                    className={styles.deleteBtn}
                                    onClick={() => handleDelete((modal as { mode: "edit"; event: CalendarEvent }).event.id)}
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
