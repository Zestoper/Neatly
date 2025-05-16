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
    // rooms : 내가 참여 중인 채팅방 목록

    const [loading, setLoading] = useState(true);

    const [newName, setNewName] = useState("");
    // newName : 새 채팅방 이름 입력값

    const [creating, setCreating] = useState(false);
    // creating : 채팅방 생성 요청 중 여부 — true이면 버튼 비활성화

    const [joinId, setJoinId] = useState("");
    // joinId : 참여할 채팅방 ID 입력값

    const [joining, setJoining] = useState(false);
    // joining : 채팅방 참여 요청 중 여부

    // 컴포넌트가 처음 렌더링될 때 채팅방 목록을 서버에서 불러옴
    useEffect(() => {
        getRooms()
            .then(setRooms)
            .finally(() => setLoading(false));
    }, []);

    // handleCreate : 새 채팅방을 생성하고 바로 입장
    const handleCreate = async () => {
        if (!newName.trim()) return;
        setCreating(true);
        try {
            const room = await createRoom(newName.trim());
            // 생성된 방을 목록 맨 앞에 추가
            setRooms((prev) => [room, ...prev]);
            setNewName("");
            // 생성 후 바로 해당 채팅방으로 이동
            navigate(`/chat/${room.id}`);
        } catch {
            showToast("채팅방 생성에 실패했습니다.", "error");
        } finally {
            setCreating(false);
        }
    };

    // handleJoin : 방 ID를 입력해서 채팅방에 참여
    const handleJoin = async () => {
        if (!joinId.trim()) return;
        setJoining(true);
        try {
            const room = await joinRoom(joinId.trim());
            // 이미 목록에 없는 방이면 추가
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

            {/* 채팅방 생성 / 참여 입력 영역 */}
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

            {/* 채팅방 목록 */}
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
