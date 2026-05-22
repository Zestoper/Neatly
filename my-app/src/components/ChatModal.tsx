import { useCallback, useEffect, useRef, useState } from "react";
import {
    getRooms, createRoom, joinRoom, getMessages, searchUsers, inviteToRoom,
    getFriends, addFriend, getOrCreateDm, leaveRoom, markRoomRead, getRoomReadStatus,
    uploadChatImage, updateFriendStatus, removeFriend,
} from "../api/chat";
import type { ChatRoom, Contact } from "../api/chat";
import { useToast } from "../context/ToastContext";
import ConfirmModal from "./ConfirmModal";

const IMG_PREFIX = "__img__:";
const WS_BASE = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/^http/, "ws");
import styles from "./ChatModal.module.css";

// ─── 타입 ────────────────────────────────────────────────
type Tab = "rooms" | "friends" | "add";

// WsMessage : 채팅 WebSocket에서 오는 메시지 형식
type WsMessage = {
    type: "message" | "system" | "read";
    id?: string;
    user_id?: string;
    user_name?: string;
    content: string;
    created_at: string;
    read_at?: string;
};

// ─── JWT에서 내 user_id 추출 ────────────────────────────
function getMyUserId(): string {
    const token = localStorage.getItem("token");
    if (!token) return "";
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        return payload.sub ?? "";
    } catch {
        return "";
    }
}

// "A, B" 형식의 DM 방 이름에서 내 이름을 제거해 상대방 이름만 표시
function formatRoomName(name: string): string {
    const myName = localStorage.getItem("userName") ?? "";
    if (!myName) return name;
    const parts = name.split(", ");
    if (parts.length === 2) {
        const other = parts.find((p) => p !== myName);
        if (other) return other;
    }
    return name;
}

function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const isToday =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();
    return isToday ? formatTime(iso) : d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

// ─── 메인 컴포넌트 ────────────────────────────────────────
export default function ChatModal() {
    const { showToast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [tab, setTab] = useState<Tab>("rooms");
    const [activeRoom, setActiveRoom] = useState<{ id: string; name: string } | null>(null);

    // 채팅방 탭
    const [rooms, setRooms] = useState<ChatRoom[]>([]);
    const [roomsLoading, setRoomsLoading] = useState(false);
    const [roomSearch, setRoomSearch] = useState("");
    const [newRoomName, setNewRoomName] = useState("");
    const [creating, setCreating] = useState(false);
    const [joinId, setJoinId] = useState("");
    const [showJoinInput, setShowJoinInput] = useState(false);

    // 친구 탭 — 실제 친구 목록
    const [friends, setFriends] = useState<Contact[]>([]);
    const [friendSearch, setFriendSearch] = useState("");
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
    const [showHidden, setShowHidden] = useState(false);
    const [showBlocked, setShowBlocked] = useState(false);

    // 친구 추가 탭 — 유저 검색 후 친구 추가
    const [addQuery, setAddQuery] = useState("");
    const [addResults, setAddResults] = useState<Contact[]>([]);
    const [addSearching, setAddSearching] = useState(false);
    const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
    // addedIds : 이미 친구 추가한 유저 ID 집합

    // Presence WebSocket — 온라인 상태 + 알림
    const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
    const [unreadCount, setUnreadCount] = useState(0);
    const presenceWsRef = useRef<WebSocket | null>(null);

    // 멤버 초대 패널
    const [showInvite, setShowInvite] = useState(false);
    const [inviteQuery, setInviteQuery] = useState("");
    const [inviteResults, setInviteResults] = useState<Contact[]>([]);
    const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());

    // 읽음 상태 — { userId: lastReadAt ISO | null }
    const [readStatus, setReadStatus] = useState<Record<string, string | null>>({});

    // 채팅창
    const [messages, setMessages] = useState<WsMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [connected, setConnected] = useState(false);
    const chatWsRef = useRef<WebSocket | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const myUserId = useRef(getMyUserId());
    const [uploading, setUploading] = useState(false);
    const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void; confirmLabel?: string } | null>(null);

    // ── Presence WS — 컴포넌트 마운트 시 연결, 언마운트 시 해제 ──────
    // 모달이 닫혀 있어도 알림을 받기 위해 항상 유지
    useEffect(() => {
        const token = localStorage.getItem("token") ?? "";
        if (!token) return;

        // 브라우저 알림 권한 요청 (최초 1회)
        if (Notification.permission === "default") {
            Notification.requestPermission();
        }

        // 마운트 시 방 목록 로드 → 초기 안읽음 배지 표시
        getRooms().then((loadedRooms) => {
            setRooms(loadedRooms);
            const total = loadedRooms.reduce((sum, r) => sum + (r.unread_count ?? 0), 0);
            setUnreadCount(total);
        }).catch(() => {});

        const ws = new WebSocket(`${WS_BASE}/ws/presence?token=${token}`);
        presenceWsRef.current = ws;

        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === "init") {
                setOnlineIds(new Set(msg.online_ids as string[]));
            } else if (msg.type === "online") {
                setOnlineIds((prev) => new Set([...prev, msg.user_id]));
            } else if (msg.type === "offline") {
                setOnlineIds((prev) => {
                    const next = new Set(prev);
                    next.delete(msg.user_id);
                    return next;
                });
            } else if (msg.type === "room_invited") {
                setRooms((prev) =>
                    prev.some((r) => r.id === msg.room.id) ? prev : [msg.room, ...prev]
                );
                setUnreadCount((prev) => prev + (msg.room?.unread_count ?? 1));
            } else if (msg.type === "read") {
                if (msg.user_id) setReadStatus((prev) => ({ ...prev, [msg.user_id!]: msg.read_at ?? null }));
            } else if (msg.type === "new_message") {
                setUnreadCount((prev) => prev + 1);
                setRooms((prev) => prev.map((r) =>
                    r.id === msg.room_id ? { ...r, unread_count: r.unread_count + 1, last_message: msg.content, last_message_at: new Date().toISOString() } : r
                ));
                if (Notification.permission === "granted" && document.visibilityState === "hidden") {
                    new Notification(msg.room_name, {
                        body: `${msg.sender}: ${msg.content}`,
                    });
                }
            }
        };

        return () => {
            ws.close();
            presenceWsRef.current = null;
        };
    }, []);

    // ── 모달 열릴 때 데이터 로드 ──────────────────────────
    useEffect(() => {
        if (!isOpen) return;

        setRoomsLoading(true);
        getRooms().then((loadedRooms) => {
            setRooms(loadedRooms);
            // rooms 실제 unread_count 합계로 배지 재계산
            const total = loadedRooms.reduce((sum, r) => sum + (r.unread_count ?? 0), 0);
            setUnreadCount(total);
        }).finally(() => setRoomsLoading(false));
        getFriends().then(setFriends).catch(() => {});
    }, [isOpen]);

    // 새 메시지 올 때 스크롤 맨 아래로
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // ESC로 닫기
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (activeRoom) closeRoom();
                else setIsOpen(false);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [activeRoom]);

    // ── 채팅방 열기 (이전 메시지 + WebSocket) ────────────
    const openRoom = useCallback(async (roomId: string, roomName: string) => {
        setActiveRoom({ id: roomId, name: roomName });
        setMessages([]);
        setConnected(false);
        setReadStatus({});

        // 방 열자마자 읽음 처리 + 읽음 상태 조회
        markRoomRead(roomId).catch(() => {});
        getRoomReadStatus(roomId).then(setReadStatus).catch(() => {});

        // 방 목록의 unread_count를 0으로 갱신하면서, FAB 배지에서도 해당 수만큼 차감
        setRooms((prev) => {
            const target = prev.find((r) => r.id === roomId);
            if (target && target.unread_count > 0) {
                setUnreadCount((c) => Math.max(0, c - target.unread_count));
            }
            return prev.map((r) => r.id === roomId ? { ...r, unread_count: 0 } : r);
        });

        try {
            const history = await getMessages(roomId);
            setMessages(history.map((m) => ({
                type: "message" as const,
                id: m.id,
                user_id: m.user_id,
                user_name: m.user_name,
                content: m.content,
                created_at: m.created_at,
            })));
        } catch {}

        const token = localStorage.getItem("token") ?? "";
        const ws = new WebSocket(`${WS_BASE}/ws/chat/${roomId}?token=${token}`);
        chatWsRef.current = ws;
        ws.onopen = () => setConnected(true);
        ws.onclose = () => setConnected(false);
        ws.onmessage = (e) => {
            const msg: WsMessage = JSON.parse(e.data);
            if (msg.type === "read") {
                if (msg.user_id) setReadStatus((prev) => ({ ...prev, [msg.user_id!]: msg.read_at ?? null }));
                return;
            }
            setMessages((prev) => [...prev, msg]);
            // 내가 보고 있는 방에 메시지가 오면 자동 읽음 처리
            if (msg.type === "message" && msg.user_id !== myUserId.current) {
                markRoomRead(roomId).catch(() => {});
            }
        };
    }, []);

    const closeRoom = useCallback(() => {
        chatWsRef.current?.close();
        chatWsRef.current = null;
        setActiveRoom(null);
        setMessages([]);
        setChatInput("");
        setShowInvite(false);
        setInviteQuery("");
        setInviteResults([]);
        setInvitedIds(new Set());
        setReadStatus({});
    }, []);

    // ── 채팅방 나가기 ────────────────────────────────────
    const handleLeaveRoom = () => {
        if (!activeRoom) return;
        setConfirmModal({
            message: `"${formatRoomName(activeRoom.name)}" 채팅방에서 나가시겠습니까?`,
            confirmLabel: "나가기",
            onConfirm: async () => {
                setConfirmModal(null);
                await leaveRoom(activeRoom.id);
                setRooms((prev) => prev.filter((r) => r.id !== activeRoom.id));
                closeRoom();
            },
        });
    };

    // ── 멤버 초대 ────────────────────────────────────────
    const handleInviteSearch = async () => {
        if (!inviteQuery.trim()) return;
        const results = await searchUsers(inviteQuery.trim());
        setInviteResults(results);
    };

    const handleInvite = async (userId: string) => {
        if (!activeRoom) return;
        try {
            await inviteToRoom(activeRoom.id, userId);
            setInvitedIds((prev) => new Set([...prev, userId]));
        } catch {
            // 이미 멤버인 경우도 초대됨으로 표시
            setInvitedIds((prev) => new Set([...prev, userId]));
        }
    };

    const handleClose = () => {
        closeRoom();
        // presence WS는 닫지 않음 — 모달이 닫혀도 알림 수신 유지
        setIsOpen(false);
    };

    // ── 메시지 전송 ───────────────────────────────────────
    const sendMessage = () => {
        const content = chatInput.trim();
        if (!content || chatWsRef.current?.readyState !== WebSocket.OPEN) return;
        chatWsRef.current.send(JSON.stringify({ content }));
        setChatInput("");
    };

    // ── 이미지 전송 ───────────────────────────────────────
    const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (chatWsRef.current?.readyState !== WebSocket.OPEN) return;
        e.target.value = "";
        setUploading(true);
        try {
            const url = await uploadChatImage(file);
            chatWsRef.current.send(JSON.stringify({ content: `${IMG_PREFIX}${url}` }));
        } catch {
            showToast("이미지 업로드에 실패했습니다.");
        } finally {
            setUploading(false);
        }
    };

    // ── 채팅방 생성 ───────────────────────────────────────
    const handleCreateRoom = async () => {
        if (!newRoomName.trim()) return;
        setCreating(true);
        try {
            const room = await createRoom(newRoomName.trim());
            setRooms((prev) => [room, ...prev]);
            setNewRoomName("");
            openRoom(room.id, room.name);
        } finally {
            setCreating(false);
        }
    };

    // ── 방 ID로 참여 ─────────────────────────────────────
    const handleJoinRoom = async () => {
        if (!joinId.trim()) return;
        try {
            const room = await joinRoom(joinId.trim());
            setRooms((prev) => prev.some((r) => r.id === room.id) ? prev : [room, ...prev]);
            setJoinId("");
            setShowJoinInput(false);
            openRoom(room.id, room.name);
        } catch {
            showToast("채팅방을 찾을 수 없습니다.");
        }
    };

    // ── 대화 상대 클릭 → 1:1 DM 방 (양쪽이 같은 방 공유) ──
    const handleContactClick = async (contact: Contact) => {
        try {
            const room = await getOrCreateDm(contact.id);
            setRooms((prev) => prev.some((r) => r.id === room.id) ? prev : [room, ...prev]);
            openRoom(room.id, room.name);
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            showToast(msg ?? "대화를 시작할 수 없습니다.");
        }
    };

    // ── 유저 검색 ────────────────────────────────────────
    const handleAddSearch = async () => {
        if (!addQuery.trim()) return;
        setAddSearching(true);
        try {
            const results = await searchUsers(addQuery.trim());
            setAddResults(results);
        } finally {
            setAddSearching(false);
        }
    };

    // ── 친구 추가 ────────────────────────────────────────
    const handleAddFriend = async (contact: Contact) => {
        try {
            await addFriend(contact.id);
            setAddedIds((prev) => new Set([...prev, contact.id]));
            // 친구 목록에 즉시 반영
            setFriends((prev) => prev.some((f) => f.id === contact.id) ? prev : [...prev, contact]);
        } catch {
            // 이미 친구인 경우도 추가됨으로 표시
            setAddedIds((prev) => new Set([...prev, contact.id]));
        }
    };

    // ── 친구 상태 변경 ───────────────────────────────────
    const handleFriendStatus = async (friendId: string, status: "active" | "hidden" | "blocked") => {
        await updateFriendStatus(friendId, status);
        setFriends((prev) => prev.map((f) => f.id === friendId ? { ...f, status } : f));
        setMenuOpenId(null);
    };

    const handleRemoveFriend = (friendId: string) => {
        setConfirmModal({
            message: "친구를 삭제하시겠습니까?",
            confirmLabel: "삭제",
            onConfirm: async () => {
                setConfirmModal(null);
                await removeFriend(friendId);
                setFriends((prev) => prev.filter((f) => f.id !== friendId));
                setMenuOpenId(null);
            },
        });
    };

    // ── 필터링 ──────────────────────────────────────────
    const filteredRooms = rooms.filter((r) =>
        r.name.toLowerCase().includes(roomSearch.toLowerCase())
    );
    const activeFriends = friends.filter((c) =>
        (c.status ?? "active") === "active" &&
        (c.name.includes(friendSearch) || c.email.includes(friendSearch))
    );
    const hiddenFriends = friends.filter((c) => (c.status ?? "active") === "hidden");
    const blockedFriends = friends.filter((c) => (c.status ?? "active") === "blocked");

    // ─────────────────────────────────────────────────────
    return (
        <>
            {/* FAB + 뱃지 */}
            <div className={styles.fabWrapper}>
                <button className={styles.fab} onClick={() => isOpen ? handleClose() : setIsOpen(true)} title="채팅">
                    {isOpen ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                    )}
                </button>
                {unreadCount > 0 && !isOpen && (
                    <span className={styles.fabBadge}>{unreadCount > 99 ? "99+" : unreadCount}</span>
                )}
            </div>

            {isOpen && (
                <div className={styles.backdrop} onClick={handleClose} />
            )}

            {isOpen && (
                <div className={styles.modal}>

                    {/* ── 채팅창 뷰 ── */}
                    {activeRoom ? (
                        <div className={styles.chatView}>
                            <div className={styles.chatHeader}>
                                <button className={styles.backBtn} onClick={closeRoom}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                        <polyline points="15 18 9 12 15 6" />
                                    </svg>
                                </button>
                                <div className={styles.chatHeaderInfo}>
                                    <span className={styles.chatRoomName}>{formatRoomName(activeRoom.name)}</span>
                                    <span className={connected ? styles.statusOnline : styles.statusOffline}>
                                        {connected ? "연결됨" : "연결 중..."}
                                    </span>
                                </div>
                                <button className={styles.inviteBtn} onClick={() => setShowInvite((v) => !v)} title="멤버 초대">
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                                        <circle cx="9" cy="7" r="4" />
                                        <line x1="19" y1="8" x2="19" y2="14" />
                                        <line x1="22" y1="11" x2="16" y2="11" />
                                    </svg>
                                </button>
                                <button className={styles.copyIdBtn} onClick={() => navigator.clipboard.writeText(activeRoom.id)} title="방 ID 복사">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <rect x="9" y="9" width="13" height="13" rx="2" />
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                    </svg>
                                </button>
                                <button className={styles.leaveBtn} onClick={handleLeaveRoom} title="채팅방 나가기">
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                        <polyline points="16 17 21 12 16 7" />
                                        <line x1="21" y1="12" x2="9" y2="12" />
                                    </svg>
                                </button>
                            </div>

                            {showInvite && (
                                <div className={styles.invitePanel}>
                                    <div className={styles.inviteRow}>
                                        <input
                                            className={styles.createInput}
                                            placeholder="이름 또는 이메일로 검색"
                                            value={inviteQuery}
                                            onChange={(e) => setInviteQuery(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === "Enter") handleInviteSearch(); }}
                                            autoFocus
                                        />
                                        <button className={styles.createBtn} onClick={handleInviteSearch}>검색</button>
                                    </div>
                                    {inviteResults.length > 0 && (
                                        <div className={styles.inviteResults}>
                                            {inviteResults.map((u) => (
                                                <div key={u.id} className={styles.inviteItem}>
                                                    <div className={styles.friendAvatar} style={{ width: 30, height: 30, fontSize: 13 }}>
                                                        {(u.name || u.email)[0].toUpperCase()}
                                                    </div>
                                                    <div className={styles.itemInfo}>
                                                        <span className={styles.itemName}>{u.name || u.email}</span>
                                                    </div>
                                                    <button
                                                        className={invitedIds.has(u.id) ? styles.sentBtn : styles.addBtn}
                                                        onClick={() => handleInvite(u.id)}
                                                        disabled={invitedIds.has(u.id)}
                                                    >
                                                        {invitedIds.has(u.id) ? "초대됨" : "초대"}
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {inviteResults.length === 0 && inviteQuery && (
                                        <span className={styles.empty}>사용자를 찾을 수 없습니다.</span>
                                    )}
                                </div>
                            )}

                            <div className={styles.messageList}>
                                {messages.length === 0 && (
                                    <span className={styles.emptyChat}>첫 메시지를 보내보세요.</span>
                                )}
                                {messages.map((msg, i) => {
                                    if (msg.type === "system") {
                                        return <div key={i} className={styles.systemMsg}>{msg.content}</div>;
                                    }
                                    const isMe = msg.user_id === myUserId.current;
                                    // 내 메시지 기준: 아직 읽지 않은 상대방 수
                                    const msgTime = new Date(msg.created_at).getTime();
                                    const unreadBy = isMe
                                        ? Object.entries(readStatus).filter(([uid, readAt]) => {
                                            if (uid === myUserId.current) return false;
                                            return !readAt || new Date(readAt).getTime() < msgTime;
                                        }).length
                                        : 0;
                                    const isImage = msg.content.startsWith(IMG_PREFIX);
                                    const imgUrl = isImage ? msg.content.slice(IMG_PREFIX.length) : null;
                                    return (
                                        <div key={msg.id ?? i} className={isMe ? styles.msgRowMe : styles.msgRowOther}>
                                            {!isMe && (
                                                <div className={styles.avatar}>{msg.user_name?.[0] ?? "?"}</div>
                                            )}
                                            <div className={styles.msgContent}>
                                                {!isMe && <span className={styles.msgUserName}>{msg.user_name}</span>}
                                                <div className={isMe ? styles.bubbleMe : styles.bubbleOther}>
                                                    {isImage ? (
                                                        <img
                                                            src={imgUrl!}
                                                            className={styles.chatImage}
                                                            alt="이미지"
                                                            onClick={() => window.open(imgUrl!, "_blank")}
                                                        />
                                                    ) : (
                                                        <span className={styles.bubbleText}>{msg.content}</span>
                                                    )}
                                                </div>
                                                <div className={styles.msgMeta}>
                                                    {isMe && unreadBy > 0 && (
                                                        <span className={styles.unreadMark}>{unreadBy}</span>
                                                    )}
                                                    <span className={styles.msgTime}>{formatTime(msg.created_at)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div ref={bottomRef} />
                            </div>

                            <div className={styles.chatInputRow}>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    style={{ display: "none" }}
                                    onChange={handleImageSelect}
                                />
                                <button
                                    className={styles.imageBtn}
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={!connected || uploading}
                                    title="이미지 전송"
                                >
                                    {uploading ? (
                                        <span className={styles.uploadingDot} />
                                    ) : (
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="3" y="3" width="18" height="18" rx="2" />
                                            <circle cx="8.5" cy="8.5" r="1.5" />
                                            <polyline points="21 15 16 10 5 21" />
                                        </svg>
                                    )}
                                </button>
                                <input
                                    className={styles.chatInput}
                                    placeholder={connected ? "메시지 입력..." : "연결 중..."}
                                    value={chatInput}
                                    onChange={(e) => setChatInput(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendMessage(); } }}
                                    disabled={!connected}
                                />
                                <button className={styles.sendBtn} onClick={sendMessage} disabled={!connected || !chatInput.trim()}>
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                    ) : (
                        /* ── 탭 목록 뷰 ── */
                        <div className={styles.tabView}>
                            <div className={styles.tabBar}>
                                {(["rooms", "friends", "add"] as Tab[]).map((t) => (
                                    <button
                                        key={t}
                                        className={tab === t ? styles.tabActive : styles.tabBtn}
                                        onClick={() => setTab(t)}
                                    >
                                        {t === "rooms" ? "채팅방" : t === "friends" ? "친구" : "친구 추가"}
                                    </button>
                                ))}
                            </div>

                            {/* ── 채팅방 탭 ── */}
                            {tab === "rooms" && (
                                <div className={styles.tabContent}>
                                    <input className={styles.searchInput} placeholder="채팅방 검색" value={roomSearch} onChange={(e) => setRoomSearch(e.target.value)} />
                                    <div className={styles.createRow}>
                                        <input className={styles.createInput} placeholder="새 채팅방 이름" value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleCreateRoom(); }} />
                                        <button className={styles.createBtn} onClick={handleCreateRoom} disabled={creating || !newRoomName.trim()}>
                                            {creating ? "..." : "+"}
                                        </button>
                                    </div>
                                    <button className={styles.joinToggleBtn} onClick={() => setShowJoinInput((v) => !v)}>
                                        방 ID로 참여
                                    </button>
                                    {showJoinInput && (
                                        <div className={styles.createRow}>
                                            <input className={styles.createInput} placeholder="채팅방 ID" value={joinId} onChange={(e) => setJoinId(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleJoinRoom(); }} />
                                            <button className={styles.createBtn} onClick={handleJoinRoom}>참여</button>
                                        </div>
                                    )}
                                    <div className={styles.list}>
                                        {roomsLoading && <span className={styles.empty}>불러오는 중...</span>}
                                        {!roomsLoading && filteredRooms.length === 0 && (
                                            <span className={styles.empty}>{roomSearch ? "검색 결과 없음" : "참여 중인 채팅방이 없습니다."}</span>
                                        )}
                                        {filteredRooms.map((room) => (
                                            <div key={room.id} className={styles.listItem} onClick={() => openRoom(room.id, room.name)}>
                                                <div className={styles.roomAvatar}>{formatRoomName(room.name)[0]}</div>
                                                <div className={styles.itemInfo}>
                                                    <div className={styles.itemRow}>
                                                        <span className={styles.itemName}>{formatRoomName(room.name)}</span>
                                                        <span className={styles.itemTime}>{formatDate(room.last_message_at)}</span>
                                                    </div>
                                                    <div className={styles.itemSubRow}>
                                                        <span className={styles.itemSub}>{room.last_message ?? "대화를 시작해보세요"}</span>
                                                        {room.unread_count > 0 && (
                                                            <span className={styles.unreadBadge}>{room.unread_count}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* ── 친구 탭 ── */}
                            {tab === "friends" && (
                                <div className={styles.tabContent}>
                                    <input className={styles.searchInput} placeholder="친구 검색" value={friendSearch} onChange={(e) => setFriendSearch(e.target.value)} />
                                    <div className={styles.list} onClick={() => setMenuOpenId(null)}>
                                        {activeFriends.length === 0 && hiddenFriends.length === 0 && blockedFriends.length === 0 && (
                                            <span className={styles.empty}>친구가 없습니다.{"\n"}친구 추가 탭에서 추가해보세요.</span>
                                        )}
                                        {activeFriends.map((c) => {
                                            const isOnline = onlineIds.has(c.id);
                                            return (
                                                <div key={c.id} className={styles.friendItem}>
                                                    <div className={styles.friendItemMain} onClick={() => handleContactClick(c)}>
                                                        <div className={styles.friendAvatar}>
                                                            {(c.name || c.email)[0].toUpperCase()}
                                                            <span className={isOnline ? styles.onlineDot : styles.offlineDot} />
                                                        </div>
                                                        <div className={styles.itemInfo}>
                                                            <span className={styles.itemName}>{c.name || c.email}</span>
                                                            <span className={styles.itemSub}>{c.email}</span>
                                                        </div>
                                                        <span className={isOnline ? styles.onlineBadge : styles.offlineBadge}>
                                                            {isOnline ? "온라인" : "오프라인"}
                                                        </span>
                                                    </div>
                                                    {/* 세 점 메뉴 */}
                                                    <div className={styles.friendMenuWrap}>
                                                        <button
                                                            className={styles.menuDotBtn}
                                                            onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === c.id ? null : c.id); }}
                                                        >
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                                                <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
                                                            </svg>
                                                        </button>
                                                        {menuOpenId === c.id && (
                                                            <div className={styles.friendMenu} onClick={(e) => e.stopPropagation()}>
                                                                <button className={styles.friendMenuItem} onClick={() => handleContactClick(c)}>채팅하기</button>
                                                                <button className={styles.friendMenuItem} onClick={() => handleFriendStatus(c.id, "hidden")}>숨기기</button>
                                                                <button className={styles.friendMenuItem} onClick={() => handleFriendStatus(c.id, "blocked")}>차단하기</button>
                                                                <button className={`${styles.friendMenuItem} ${styles.friendMenuItemDanger}`} onClick={() => handleRemoveFriend(c.id)}>친구 삭제</button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {/* 숨긴 친구 섹션 */}
                                        {hiddenFriends.length > 0 && (
                                            <div className={styles.friendSection}>
                                                <button className={styles.friendSectionToggle} onClick={() => setShowHidden((v) => !v)}>
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                                        {showHidden ? <polyline points="18 15 12 9 6 15"/> : <polyline points="6 9 12 15 18 9"/>}
                                                    </svg>
                                                    숨긴 친구 {hiddenFriends.length}명
                                                </button>
                                                {showHidden && hiddenFriends.map((c) => (
                                                    <div key={c.id} className={styles.friendItem}>
                                                        <div className={styles.friendItemMain}>
                                                            <div className={styles.friendAvatarMuted}>
                                                                {(c.name || c.email)[0].toUpperCase()}
                                                            </div>
                                                            <div className={styles.itemInfo}>
                                                                <span className={styles.itemName}>{c.name || c.email}</span>
                                                                <span className={styles.itemSub}>{c.email}</span>
                                                            </div>
                                                        </div>
                                                        <div className={styles.friendMenuWrap}>
                                                            <button className={styles.menuDotBtn} onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === c.id ? null : c.id); }}>
                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                                                    <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
                                                                </svg>
                                                            </button>
                                                            {menuOpenId === c.id && (
                                                                <div className={styles.friendMenu} onClick={(e) => e.stopPropagation()}>
                                                                    <button className={styles.friendMenuItem} onClick={() => handleFriendStatus(c.id, "active")}>숨김 해제</button>
                                                                    <button className={styles.friendMenuItem} onClick={() => handleFriendStatus(c.id, "blocked")}>차단하기</button>
                                                                    <button className={`${styles.friendMenuItem} ${styles.friendMenuItemDanger}`} onClick={() => handleRemoveFriend(c.id)}>친구 삭제</button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* 차단한 사람 섹션 */}
                                        {blockedFriends.length > 0 && (
                                            <div className={styles.friendSection}>
                                                <button className={styles.friendSectionToggle} onClick={() => setShowBlocked((v) => !v)}>
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                                        {showBlocked ? <polyline points="18 15 12 9 6 15"/> : <polyline points="6 9 12 15 18 9"/>}
                                                    </svg>
                                                    차단한 사람 {blockedFriends.length}명
                                                </button>
                                                {showBlocked && blockedFriends.map((c) => (
                                                    <div key={c.id} className={styles.friendItem}>
                                                        <div className={styles.friendItemMain}>
                                                            <div className={styles.friendAvatarMuted}>
                                                                {(c.name || c.email)[0].toUpperCase()}
                                                            </div>
                                                            <div className={styles.itemInfo}>
                                                                <span className={styles.itemName}>{c.name || c.email}</span>
                                                                <span className={`${styles.itemSub} ${styles.blockedLabel}`}>차단됨</span>
                                                            </div>
                                                        </div>
                                                        <div className={styles.friendMenuWrap}>
                                                            <button className={styles.menuDotBtn} onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === c.id ? null : c.id); }}>
                                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                                                    <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
                                                                </svg>
                                                            </button>
                                                            {menuOpenId === c.id && (
                                                                <div className={styles.friendMenu} onClick={(e) => e.stopPropagation()}>
                                                                    <button className={styles.friendMenuItem} onClick={() => handleFriendStatus(c.id, "active")}>차단 해제</button>
                                                                    <button className={`${styles.friendMenuItem} ${styles.friendMenuItemDanger}`} onClick={() => handleRemoveFriend(c.id)}>친구 삭제</button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* ── 친구 추가 탭 (유저 검색 후 친구 추가) ── */}
                            {tab === "add" && (
                                <div className={styles.tabContent}>
                                    <span className={styles.addDesc}>이메일 또는 이름으로 검색</span>
                                    <div className={styles.createRow}>
                                        <input className={styles.createInput} placeholder="이메일 또는 이름" value={addQuery} onChange={(e) => setAddQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleAddSearch(); }} />
                                        <button className={styles.createBtn} onClick={handleAddSearch} disabled={addSearching || !addQuery.trim()}>
                                            {addSearching ? "..." : "검색"}
                                        </button>
                                    </div>
                                    <div className={styles.list}>
                                        {addResults.length === 0 && addQuery && !addSearching && (
                                            <span className={styles.empty}>사용자를 찾을 수 없습니다.</span>
                                        )}
                                        {addResults.map((u) => (
                                            <div key={u.id} className={styles.addResult}>
                                                <div className={styles.friendAvatar}>
                                                    {(u.name || u.email)[0].toUpperCase()}
                                                </div>
                                                <div className={styles.itemInfo}>
                                                    <span className={styles.itemName}>{u.name || u.email}</span>
                                                    <span className={styles.itemSub}>{u.email}</span>
                                                </div>
                                                <button
                                                    className={addedIds.has(u.id) ? styles.sentBtn : styles.addBtn}
                                                    onClick={() => handleAddFriend(u)}
                                                    disabled={addedIds.has(u.id)}
                                                >
                                                    {addedIds.has(u.id) ? "추가됨" : "추가"}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        {confirmModal && (
            <ConfirmModal
                message={confirmModal.message}
                confirmLabel={confirmModal.confirmLabel ?? "확인"}
                danger
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal(null)}
            />
        )}
        </>
    );
}
