from sqlalchemy import Column, String, Enum, DateTime, Boolean, ForeignKey, Text, Index
from sqlalchemy.ext.declarative import declarative_base
import uuid
from datetime import datetime

Base = declarative_base()


class User(Base):
    __tablename__ = "User"

    id            = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email         = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    name          = Column(String(100), nullable=False, default='')
    phone         = Column(String(20), nullable=True)
    birth_date    = Column(String(10), nullable=True)
    plan          = Column(Enum('FREE', 'STANDARD', 'PREMIUM', name='user_plan'), default='FREE')
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    gmail_access_token  = Column(Text, nullable=True)
    gmail_refresh_token = Column(Text, nullable=True)
    gmail_token_expiry  = Column(DateTime, nullable=True)
    gmail_last_sync     = Column(DateTime, nullable=True)
    gmail_last_view     = Column(DateTime, nullable=True)


class Folder(Base):
    __tablename__ = "Folder"

    id          = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id     = Column(String(36), ForeignKey("User.id"), nullable=False, index=True)
    name        = Column(String(100), nullable=False)
    folder_type = Column(String(20), nullable=False, default="document", server_default="document")
    created_at  = Column(DateTime, default=datetime.utcnow)


class Tag(Base):
    __tablename__ = "Tag"

    id         = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = Column(String(36), ForeignKey("User.id"), nullable=False, index=True)
    name       = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class DocumentTag(Base):
    __tablename__ = "DocumentTag"

    document_id = Column(String(36), ForeignKey("Document.id"), primary_key=True)
    tag_id      = Column(String(36), ForeignKey("Tag.id"), primary_key=True)


class EmailFilter(Base):
    __tablename__ = "EmailFilter"

    id         = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = Column(String(36), ForeignKey("User.id"), nullable=False, index=True)
    sender     = Column(String(255), nullable=False)
    name       = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatRoom(Base):
    __tablename__ = "ChatRoom"

    id          = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name        = Column(String(100), nullable=False)
    document_id = Column(String(36), ForeignKey("Document.id"), nullable=True)
    created_by  = Column(String(36), ForeignKey("User.id"), nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)


class ChatRoomMember(Base):
    __tablename__ = "ChatRoomMember"

    room_id   = Column(String(36), ForeignKey("ChatRoom.id"), primary_key=True)
    user_id   = Column(String(36), ForeignKey("User.id"), primary_key=True)
    joined_at = Column(DateTime, default=datetime.utcnow)


class ChatMessage(Base):
    __tablename__ = "ChatMessage"
    __table_args__ = (
        Index("ix_chatmessage_room_created", "room_id", "created_at"),
    )

    id         = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id    = Column(String(36), ForeignKey("ChatRoom.id"), nullable=False)
    user_id    = Column(String(36), ForeignKey("User.id"), nullable=False)
    user_name  = Column(String(100), nullable=False)
    content    = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatRoomRead(Base):
    __tablename__ = "ChatRoomRead"

    room_id      = Column(String(36), ForeignKey("ChatRoom.id"), primary_key=True)
    user_id      = Column(String(36), ForeignKey("User.id"), primary_key=True)
    last_read_at = Column(DateTime, nullable=False)


class Friend(Base):
    __tablename__ = "Friend"
    __table_args__ = (
        Index("ix_friend_user_id", "user_id"),
    )

    user_id    = Column(String(36), ForeignKey("User.id"), primary_key=True)
    friend_id  = Column(String(36), ForeignKey("User.id"), primary_key=True)
    status     = Column(Enum("active", "hidden", "blocked", name='friend_status'), nullable=False, default="active", server_default="active")
    created_at = Column(DateTime, default=datetime.utcnow)


class CalendarEvent(Base):
    __tablename__ = "CalendarEvent"

    id          = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id     = Column(String(36), ForeignKey("User.id"), nullable=False, index=True)
    title       = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    event_date  = Column(DateTime, nullable=False)
    document_id   = Column(String(36), ForeignKey("Document.id"), nullable=True)
    email_id      = Column(String(255), nullable=True)
    email_subject = Column(String(500), nullable=True)
    created_at    = Column(DateTime, default=datetime.utcnow)


class Document(Base):
    __tablename__ = "Document"
    __table_args__ = (
        Index("ix_document_user_deleted", "user_id", "deleted_at"),
        Index("ix_document_user_created", "user_id", "created_at"),
    )

    id        = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id   = Column(String(36), ForeignKey("User.id"))
    folder_id = Column(String(36), ForeignKey("Folder.id"), nullable=True, index=True)

    title    = Column(String(255))
    raw_text = Column(Text)

    status = Column(
        Enum('UPLOADED', 'PROCESSING', 'DONE', 'FAILED', name='document_status'),
        default='DONE'
    )

    summary    = Column(Text, nullable=True)
    raw_html   = Column(Text, nullable=True)
    sender           = Column(String(500), nullable=True)
    gmail_message_id = Column(String(255), nullable=True, index=True)
    deleted_at       = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
