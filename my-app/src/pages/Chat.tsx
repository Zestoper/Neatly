import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getRooms, createRoom, joinRoom } from "../api/chat";
import type { ChatRoom } from "../api/chat";
import { useToast } from "../context/ToastContext";
import styles from "./Chat.module.css";

export default function Chat() {
    const navigate = useNavigate();
    const { showToast } = useToast();

    const [rooms, setRooms] = useState<ChatRoom[]>([]);

    const [loading, setLoading] = useState(true);

    const [newName, setNewName] = useState("");

    const [creating, setCreating] = useState(false);

    const [joinId, setJoinId] = useState("");

    const [joining, setJoining] = useState(false);

    useEffect(() => {
        getRooms()
            .then(setRooms)
            .finally(() => setLoading(false));
    }, []);

    const handleCreate = async () => {
        if (!newName.trim()) return;
        setCreating(true);
        try {
            const room = await createRoom(newName.trim());

            setRooms((prev) => [room, ...prev]);
            setNewName("");

            navigate(`/chat/${room.id}`);
        } catch {
            showToast("채팅방 생성에 실패했습니다.", "error");
        } finally {
            setCreating(false);
        }
    };

    const handleJoin = async () => {
        if (!joinId.trim()) return;
        setJoining(true);
        try {
            const room = await joinRoom(joinId.trim());

            setRooms((prev) => prev.some((r) => r.id === room.id) ? prev : [room, ...prev]);
            setJoinId("");
            navigate(`/chat/${room.id}`);
        } catch {
            showToast("채팅방을 찾을 수 없습니다.", "error");
        } finally {
            setJoining(false);
        }
    };

    const formatDate = (iso: string) =>
        new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });

    if (loading) return <p>불러오는 중...</p>;

    return (
        <div className={styles.container}>
            <h1 className={styles.pageTitle}>Chat</h1>

            <div className={styles.toolbar}>
                <div className={styles.inputRow}>
                    <input
                        className={styles.input}
                        placeholder="새 채팅방 이름"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
                    />
                    <button
                        className={styles.createButton}
                        onClick={handleCreate}
                        disabled={creating || !newName.trim()}
                    >
                        {creating ? "생성 중..." : "생성"}
                    </button>
                </div>
                <div className={styles.inputRow}>
                    <input
                        className={styles.input}
                        placeholder="방 ID로 참여"
                        value={joinId}
                        onChange={(e) => setJoinId(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleJoin(); }}
                    />
                    <button
                        className={styles.joinButton}
                        onClick={handleJoin}
                        disabled={joining || !joinId.trim()}
                    >
                        {joining ? "참여 중..." : "참여"}
                    </button>
                </div>
            </div>

            <div className={styles.list}>
                {rooms.length === 0 ? (
                    <p className={styles.empty}>참여 중인 채팅방이 없습니다.</p>
                ) : (
                    rooms.map((room) => (
                        <div
                            key={room.id}
                            className={styles.roomCard}
                            onClick={() => navigate(`/chat/${room.id}`)}
                        >
                            <div className={styles.roomMeta}>
                                <p className={styles.roomName}>{room.name}</p>
                                <p className={styles.roomDate}>{formatDate(room.created_at)}</p>
                            </div>
                            {room.last_message && (
                                <p className={styles.lastMessage}>{room.last_message}</p>
                            )}
                            <span className={styles.memberCount}>{room.member_count}명</span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
