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
import { api } from "../api/client";
import { useToast } from "../context/ToastContext";
import ConfirmModal from "../components/ConfirmModal";
import styles from "./Calendar.module.css";

type Email = { id: string; subject: string; from_: string };

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
    const [emails, setEmails] = useState<Email[]>([]);
    const [modal, setModal] = useState<ModalState>(null);

    const [formTitle, setFormTitle] = useState("");
    const [formDesc, setFormDesc] = useState("");
    const [formDate, setFormDate] = useState("");
    const [formTime, setFormTime] = useState("09:00");
    const [formDocId, setFormDocId] = useState<string>("");
    const [docSearch, setDocSearch] = useState("");
    const [docDropdownOpen, setDocDropdownOpen] = useState(false);
    const [formEmailId, setFormEmailId] = useState<string>("");
    const [formEmailSubject, setFormEmailSubject] = useState<string>("");
    const [emailSearch, setEmailSearch] = useState("");
    const [emailDropdownOpen, setEmailDropdownOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);

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
        api.get("/emails").then((res) => setEmails(res.data)).catch(() => {});
    }, []);

    const filteredDocs = docSearch.trim()
        ? docs.filter((d) => d.title.toLowerCase().includes(docSearch.toLowerCase()))
        : docs;

    const filteredEmails = emailSearch.trim()
        ? emails.filter((e) => e.subject.toLowerCase().includes(emailSearch.toLowerCase()) || e.from_.toLowerCase().includes(emailSearch.toLowerCase()))
        : emails;

    const openCreate = (date: string) => {
        setFormTitle("");
        setFormDesc("");
        setFormDate(date);
        setFormTime("09:00");
        setFormDocId("");
        setDocSearch("");
        setDocDropdownOpen(false);
        setFormEmailId("");
        setFormEmailSubject("");
        setEmailSearch("");
        setEmailDropdownOpen(false);
        setModal({ mode: "create", date });
    };

    const openEdit = (ev: CalendarEvent) => {
        const dt = new Date(ev.event_date);
        setFormTitle(ev.title);
        setFormDesc(ev.description ?? "");
        setFormDate(toLocalDateString(dt));
        setFormTime(`${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`);
        setFormDocId(ev.document_id ?? "");
        setDocSearch("");
        setDocDropdownOpen(false);
        setFormEmailId(ev.email_id ?? "");
        setFormEmailSubject(ev.email_subject ?? "");
        setEmailSearch("");
        setEmailDropdownOpen(false);
        setModal({ mode: "edit", event: ev });
    };

    const closeModal = () => setModal(null);

    const handleSave = async () => {
        if (!formTitle.trim()) return;
        setSaving(true);
        try {
            const isoDate = `${formDate}T${formTime}:00`;
            const docId = formDocId || null;
            const emailId = formEmailId || null;
            const emailSubject = formEmailId ? formEmailSubject : null;
            if (modal?.mode === "create") {
                await createEvent(formTitle.trim(), isoDate, formDesc.trim() || undefined, docId, emailId, emailSubject);
                showToast("일정이 추가되었습니다.");
            } else if (modal?.mode === "edit") {
                await updateEvent(modal.event.id, {
                    title: formTitle.trim(),
                    description: formDesc.trim() || undefined,
                    event_date: isoDate,
                    document_id: docId,
                    email_id: emailId,
                    email_subject: emailSubject,
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

    const handleDelete = (id: string) => {
        setConfirmModal({
            message: "일정을 삭제할까요?",
            onConfirm: async () => {
                setConfirmModal(null);
                try {
                    await deleteEvent(id);
                    showToast("일정이 삭제되었습니다.");
                    closeModal();
                    load();
                } catch {
                    showToast("삭제에 실패했습니다.", "error");
                }
            },
        });
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
                {(year !== today.getFullYear() || month !== today.getMonth() + 1) && (
                    <button
                        className={styles.todayBtn}
                        onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth() + 1); }}
                    >
                        오늘
                    </button>
                )}
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
                                        className={(ev.document_id || ev.email_id) ? styles.eventChipLinked : styles.eventChip}
                                        onClick={(e) => { e.stopPropagation(); openEdit(ev); }}
                                        title={ev.document?.title ?? ev.email_subject ?? undefined}
                                    >
                                        {new Date(ev.event_date).toLocaleTimeString("ko-KR", {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                            hour12: false,
                                        })}{" "}
                                        {ev.title}
                                        {(ev.document_id || ev.email_id) && <span className={styles.docDot} />}
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* 오늘 일정 리스트 — 이번 달 보고 있을 때만 표시 */}
            {year === today.getFullYear() && month === today.getMonth() + 1 && (
                <div className={styles.todaySection}>
                    <p className={styles.todaySectionLabel}>오늘 일정</p>
                    {(eventsByDate[todayStr] ?? []).length === 0 ? (
                        <p className={styles.todayEmpty}>오늘 일정이 없습니다.</p>
                    ) : (
                        <div className={styles.todayList}>
                            {(eventsByDate[todayStr] ?? []).map((ev) => (
                                <div
                                    key={ev.id}
                                    className={styles.todayItem}
                                    onClick={() => openEdit(ev)}
                                >
                                    <span className={styles.todayTime}>
                                        {new Date(ev.event_date).toLocaleTimeString("ko-KR", {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                            hour12: false,
                                        })}
                                    </span>
                                    <span className={styles.todayTitle}>{ev.title}</span>
                                    {ev.document && (
                                        <Link
                                            to={`/documents/${ev.document.id}`}
                                            className={styles.todayLink}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            문서
                                        </Link>
                                    )}
                                    {ev.email_id && (
                                        <Link
                                            to={`/emails/${ev.email_id}`}
                                            className={styles.todayLink}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            메일
                                        </Link>
                                    )}
                                    {ev.description && (
                                        <span className={styles.todayDesc}>{ev.description}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
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
                        <div className={styles.pickerWrapper}>
                            {docDropdownOpen && (
                                <div className={styles.pickerBackdrop} onClick={() => setDocDropdownOpen(false)} />
                            )}
                            <button
                                type="button"
                                className={styles.pickerBtn}
                                onClick={() => { setDocDropdownOpen(o => !o); setEmailDropdownOpen(false); }}
                            >
                                <span className={formDocId ? styles.pickerSelected : styles.pickerPlaceholder}>
                                    {formDocId ? docs.find(d => d.id === formDocId)?.title ?? "문서 선택" : "문서 선택"}
                                </span>
                                {formDocId ? (
                                    <span className={styles.pickerClear} onClick={(e) => { e.stopPropagation(); setFormDocId(""); }}>✕</span>
                                ) : (
                                    <span className={styles.pickerArrow}>{docDropdownOpen ? "▲" : "▼"}</span>
                                )}
                            </button>
                            {docDropdownOpen && (
                                <div className={styles.pickerDropdown}>
                                    <input
                                        className={styles.pickerSearch}
                                        value={docSearch}
                                        onChange={(e) => setDocSearch(e.target.value)}
                                        placeholder="검색..."
                                        autoFocus
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <ul className={styles.pickerList}>
                                        {filteredDocs.length === 0 ? (
                                            <li className={styles.pickerEmpty}>문서가 없습니다.</li>
                                        ) : filteredDocs.slice(0, 30).map((d) => (
                                            <li
                                                key={d.id}
                                                className={formDocId === d.id ? styles.pickerItemActive : styles.pickerItem}
                                                onClick={() => { setFormDocId(d.id); setDocDropdownOpen(false); setDocSearch(""); }}
                                            >
                                                {d.title}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                        {editEvent?.document && (
                            <Link to={`/documents/${editEvent.document.id}`} className={styles.docLink} onClick={closeModal}>
                                문서 열기: {editEvent.document.title}
                            </Link>
                        )}

                        {emails.length > 0 && (
                            <>
                                <label className={styles.label}>메일 연결 (선택)</label>
                                <div className={styles.pickerWrapper}>
                                    {emailDropdownOpen && (
                                        <div className={styles.pickerBackdrop} onClick={() => setEmailDropdownOpen(false)} />
                                    )}
                                    <button
                                        type="button"
                                        className={styles.pickerBtn}
                                        onClick={() => { setEmailDropdownOpen(o => !o); setDocDropdownOpen(false); }}
                                    >
                                        <span className={formEmailId ? styles.pickerSelected : styles.pickerPlaceholder}>
                                            {formEmailId ? formEmailSubject || "메일 선택" : "메일 선택"}
                                        </span>
                                        {formEmailId ? (
                                            <span className={styles.pickerClear} onClick={(e) => { e.stopPropagation(); setFormEmailId(""); setFormEmailSubject(""); }}>✕</span>
                                        ) : (
                                            <span className={styles.pickerArrow}>{emailDropdownOpen ? "▲" : "▼"}</span>
                                        )}
                                    </button>
                                    {emailDropdownOpen && (
                                        <div className={styles.pickerDropdown}>
                                            <input
                                                className={styles.pickerSearch}
                                                value={emailSearch}
                                                onChange={(e) => setEmailSearch(e.target.value)}
                                                placeholder="제목 또는 발신자 검색..."
                                                autoFocus
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                            <ul className={styles.pickerList}>
                                                {filteredEmails.length === 0 ? (
                                                    <li className={styles.pickerEmpty}>메일이 없습니다.</li>
                                                ) : filteredEmails.slice(0, 30).map((e) => (
                                                    <li
                                                        key={e.id}
                                                        className={formEmailId === e.id ? styles.pickerItemActive : styles.pickerItem}
                                                        onClick={() => { setFormEmailId(e.id); setFormEmailSubject(e.subject); setEmailDropdownOpen(false); setEmailSearch(""); }}
                                                    >
                                                        <span className={styles.pickerItemTitle}>{e.subject}</span>
                                                        <span className={styles.pickerItemSub}>{e.from_}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                                {editEvent?.email_id && (
                                    <Link to={`/emails/${editEvent.email_id}`} className={styles.docLink} onClick={closeModal}>
                                        메일 열기: {editEvent.email_subject}
                                    </Link>
                                )}
                            </>
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
