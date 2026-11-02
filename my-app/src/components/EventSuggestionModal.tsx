import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, Mail, X } from "lucide-react";
import { confirmSuggestion, deleteEvent, getSuggestions, type CalendarEvent } from "../api/calendar";
import { useToast } from "../context/ToastContext";
import { useRefresh } from "../context/RefreshContext";
import styles from "./EventSuggestionModal.module.css";

// 동기화가 2분마다 돌기 때문에 1분마다 새 제안이 있는지 확인한다
const POLL_INTERVAL = 60 * 1000;

type Draft = { title: string; date: string; time: string };

const pad = (n: number) => String(n).padStart(2, "0");

function toDraft(ev: CalendarEvent): Draft {
    // event_date 는 한국 시각(시간대 없음) — "2026-11-05T18:00:00"
    const [d, t = "23:59"] = ev.event_date.split("T");
    return { title: ev.title, date: d, time: t.slice(0, 5) };
}

function dateLabel(date: string, time: string) {
    const d = new Date(`${date}T${time}:00`);
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 메일에서 찾은 일정 확인 모달.
 * AI가 메일에서 마감일 있는 할 일을 찾으면 바로 캘린더에 넣지 않고 여기서 사용자에게 물어본다.
 * - 추가: 제목·날짜를 고쳐서 캘린더에 넣을 수 있다
 * - 안 함: 제안을 지운다
 * - 나중에: 이번 접속 동안만 닫는다 (다시 접속하면 또 물어봄)
 */
export default function EventSuggestionModal() {
    const { showToast } = useToast();
    const { bump } = useRefresh();
    const [items, setItems] = useState<CalendarEvent[]>([]);
    const [drafts, setDrafts] = useState<Record<string, Draft>>({});
    const [snoozed, setSnoozed] = useState<Set<string>>(() => new Set());
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const list = await getSuggestions();
            setItems(list);
            setDrafts((prev) => {
                const next = { ...prev };
                for (const ev of list) if (!next[ev.id]) next[ev.id] = toDraft(ev);
                return next;
            });
        } catch {
            /* 로그인 전이거나 서버가 깨어나는 중 — 다음 확인 때 다시 시도 */
        }
    }, []);

    useEffect(() => {
        load();
        const id = setInterval(load, POLL_INTERVAL);
        return () => clearInterval(id);
    }, [load]);

    const visible = items.filter((ev) => !snoozed.has(ev.id));

    const remove = (id: string) => setItems((prev) => prev.filter((ev) => ev.id !== id));

    const accept = async (ev: CalendarEvent) => {
        const d = drafts[ev.id] ?? toDraft(ev);
        if (!d.title.trim() || !d.date) return;
        setBusy(ev.id);
        try {
            await confirmSuggestion(ev.id, { title: d.title.trim(), event_date: `${d.date}T${d.time || "23:59"}:00` });
            remove(ev.id);
            bump();
            showToast("캘린더에 추가했어요.");
        } catch {
            showToast("추가하지 못했어요. 다시 시도해주세요.", "error");
        } finally {
            setBusy(null);
        }
    };

    const reject = async (ev: CalendarEvent) => {
        setBusy(ev.id);
        try {
            await deleteEvent(ev.id);
            remove(ev.id);
        } catch {
            showToast("처리하지 못했어요. 다시 시도해주세요.", "error");
        } finally {
            setBusy(null);
        }
    };

    const acceptAll = async () => {
        for (const ev of visible) await accept(ev);
    };

    const later = () => setSnoozed((prev) => new Set([...prev, ...visible.map((ev) => ev.id)]));

    useEffect(() => {
        if (!visible.length) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") later(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    if (!visible.length) return null;

    const setDraft = (id: string, patch: Partial<Draft>) =>
        setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { title: "", date: "", time: "" }), ...patch } }));

    return (
        <div className={styles.overlay} onClick={later}>
            <div className={styles.box} role="dialog" aria-modal="true" aria-labelledby="sugg-title" onClick={(e) => e.stopPropagation()}>
                <div className={styles.header}>
                    <CalendarPlus size={18} />
                    <h2 id="sugg-title">메일에서 일정을 찾았어요</h2>
                    <button className={styles.close} onClick={later} aria-label="나중에">
                        <X size={16} />
                    </button>
                </div>
                <p className={styles.desc}>캘린더에 추가할 일정을 골라주세요. 제목과 시간은 고쳐서 넣을 수 있어요.</p>

                <ul className={styles.list}>
                    {visible.map((ev) => {
                        const d = drafts[ev.id] ?? toDraft(ev);
                        return (
                            <li key={ev.id} className={styles.item}>
                                <input
                                    className={styles.titleInput}
                                    value={d.title}
                                    onChange={(e) => setDraft(ev.id, { title: e.target.value })}
                                    aria-label="일정 제목"
                                />
                                <div className={styles.when}>
                                    <input type="date" value={d.date} onChange={(e) => setDraft(ev.id, { date: e.target.value })} aria-label="날짜" />
                                    <input type="time" value={d.time} onChange={(e) => setDraft(ev.id, { time: e.target.value })} aria-label="시간" />
                                    <span className={styles.whenLabel}>{d.date && dateLabel(d.date, d.time || "23:59")}</span>
                                </div>
                                {ev.email_subject && (
                                    <p className={styles.source}>
                                        <Mail size={12} /> {ev.email_subject}
                                    </p>
                                )}
                                <div className={styles.actions}>
                                    <button className={styles.rejectBtn} disabled={busy === ev.id} onClick={() => reject(ev)}>
                                        안 함
                                    </button>
                                    <button className={styles.acceptBtn} disabled={busy === ev.id} onClick={() => accept(ev)}>
                                        캘린더에 추가
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>

                <div className={styles.footer}>
                    <button className={styles.laterBtn} onClick={later}>나중에</button>
                    {visible.length > 1 && (
                        <button className={styles.acceptBtn} disabled={!!busy} onClick={acceptAll}>
                            모두 추가 ({visible.length})
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
