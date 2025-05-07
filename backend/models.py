from sqlalchemy import Column, String, Enum, DateTime, Boolean, ForeignKey, Text, Index
from sqlalchemy.dialects.mysql import CHAR
from sqlalchemy.ext.declarative import declarative_base
import uuid
from datetime import datetime

Base = declarative_base()


class User(Base):
    __tablename__ = "User"

    id            = Column(CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email         = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    name          = Column(String(100), nullable=False, default='')
    phone         = Column(String(20), nullable=True)
    birth_date    = Column(String(10), nullable=True)
    plan          = Column(Enum('FREE', 'STANDARD', 'PREMIUM'), default='FREE')
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    gmail_access_token  = Column(Text, nullable=True)   # gmail_access_token : Gmail API 호출에 쓰는 단기 토큰
    gmail_refresh_token = Column(Text, nullable=True)   # gmail_refresh_token : 만료 시 재발급용 장기 토큰
    gmail_token_expiry  = Column(DateTime, nullable=True) # gmail_token_expiry : access_token 만료 시각
    gmail_last_sync     = Column(DateTime, nullable=True) # gmail_last_sync : 마지막 자동 동기화 시각 — 이후 이메일만 가져오는 데 사용
    gmail_last_view     = Column(DateTime, nullable=True) # gmail_last_view : 사용자가 마지막으로 Emails 페이지를 열었던 시각 — 뱃지 카운트 기준


class Folder(Base):
    __tablename__ = "Folder"

    id          = Column(CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id     = Column(CHAR(36), ForeignKey("User.id"), nullable=False, index=True)
    name        = Column(String(100), nullable=False)
    # folder_type : "document" — Documents 섹션 폴더 / "email" — Emails 섹션 폴더
    folder_type = Column(String(20), nullable=False, default="document", server_default="document")
    created_at  = Column(DateTime, default=datetime.utcnow)


class Tag(Base):
    __tablename__ = "Tag"

    id         = Column(CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = Column(CHAR(36), ForeignKey("User.id"), nullable=False, index=True)
    name       = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class DocumentTag(Base):
    # DocumentTag : 문서와 태그를 연결하는 중간 테이블 (N:M 관계)
    # 하나의 문서에 여러 태그, 하나의 태그가 여러 문서에 붙을 수 있음
    __tablename__ = "DocumentTag"

    document_id = Column(CHAR(36), ForeignKey("Document.id"), primary_key=True)
    tag_id      = Column(CHAR(36), ForeignKey("Tag.id"), primary_key=True)
    # primary_key=True 두 개 → 복합 기본키 — (document_id, tag_id) 쌍이 유일해야 함


class EmailFilter(Base):
    # EmailFilter : 이메일 목록에서 특정 발신자만 보이게 하는 필터
    __tablename__ = "EmailFilter"

    id         = Column(CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = Column(CHAR(36), ForeignKey("User.id"), nullable=False, index=True)
    sender     = Column(String(255), nullable=False)
    name       = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatRoom(Base):
    __tablename__ = "ChatRoom"

    id          = Column(CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name        = Column(String(100), nullable=False)
    document_id = Column(CHAR(36), ForeignKey("Document.id"), nullable=True)
    created_by  = Column(CHAR(36), ForeignKey("User.id"), nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)


class ChatRoomMember(Base):
    __tablename__ = "ChatRoomMember"

    room_id   = Column(CHAR(36), ForeignKey("ChatRoom.id"), primary_key=True)
    user_id   = Column(CHAR(36), ForeignKey("User.id"), primary_key=True)
    joined_at = Column(DateTime, default=datetime.utcnow)


class ChatMessage(Base):
    __tablename__ = "ChatMessage"
    __table_args__ = (
        Index("ix_chatmessage_room_created", "room_id", "created_at"),
    )

    id         = Column(CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id    = Column(CHAR(36), ForeignKey("ChatRoom.id"), nullable=False)
    user_id    = Column(CHAR(36), ForeignKey("User.id"), nullable=False)
    user_name  = Column(String(100), nullable=False)
    content    = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatRoomRead(Base):
    # ChatRoomRead : 유저별 채팅방 마지막 읽은 시각 — 안읽은 메시지 수 계산에 사용
    __tablename__ = "ChatRoomRead"

    room_id      = Column(CHAR(36), ForeignKey("ChatRoom.id"), primary_key=True)
    user_id      = Column(CHAR(36), ForeignKey("User.id"), primary_key=True)
    last_read_at = Column(DateTime, nullable=False)


class Friend(Base):
    __tablename__ = "Friend"
    __table_args__ = (
        Index("ix_friend_user_id", "user_id"),
    )

    user_id    = Column(CHAR(36), ForeignKey("User.id"), primary_key=True)
    friend_id  = Column(CHAR(36), ForeignKey("User.id"), primary_key=True)
    # status : active(기본) / hidden(숨김) / blocked(차단)
    status     = Column(Enum("active", "hidden", "blocked"), nullable=False, default="active", server_default="active")
    created_at = Column(DateTime, default=datetime.utcnow)


class Document(Base):
    __tablename__ = "Document"
    __table_args__ = (
        # 거의 모든 문서 쿼리가 user_id + deleted_at 조건을 사용
        Index("ix_document_user_deleted", "user_id", "deleted_at"),
        Index("ix_document_user_created", "user_id", "created_at"),
    )

    id        = Column(CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id   = Column(CHAR(36), ForeignKey("User.id"))
    folder_id = Column(CHAR(36), ForeignKey("Folder.id"), nullable=True, index=True)

    title    = Column(String(255))
    raw_text = Column(Text)

    status = Column(
        Enum('UPLOADED', 'PROCESSING', 'DONE', 'FAILED'),
        default='DONE'
    )

    summary    = Column(Text, nullable=True)
    raw_html   = Column(Text, nullable=True)
    sender           = Column(String(500), nullable=True)
    gmail_message_id = Column(String(255), nullable=True, index=True)
    deleted_at       = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
