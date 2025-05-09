from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from models import Document, Tag, DocumentTag
from routers.auth import get_current_user, get_db
from routers.documents import doc_with_tags
from models import User

router = APIRouter()


@router.get("/search")
def search_documents(
    q: str = Query("", min_length=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not q.strip():
        return []

    term = f"%{q.strip()}%"

    # 제목·본문·요약에서 직접 매칭
    text_matches = db.query(Document).filter(
        Document.user_id == current_user.id,
        Document.deleted_at == None,
        or_(
            Document.title.ilike(term),
            Document.raw_text.ilike(term),
            Document.summary.ilike(term),
            Document.sender.ilike(term),
        ),
    ).all()

    # 태그 이름 매칭 — 해당 태그가 달린 문서 조회
    tag_matched_ids = (
        db.query(DocumentTag.document_id)
        .join(Tag, Tag.id == DocumentTag.tag_id)
        .filter(
            Tag.user_id == current_user.id,
            Tag.name.ilike(term),
        )
        .all()
    )
    tag_doc_ids = {str(row[0]) for row in tag_matched_ids}

    tag_matches = []
    if tag_doc_ids:
        tag_matches = db.query(Document).filter(
            Document.user_id == current_user.id,
            Document.deleted_at == None,
            Document.id.in_(tag_doc_ids),
        ).all()

    # 합치고 중복 제거 — 최신순 정렬
    seen: set[str] = set()
    results = []
    for doc in text_matches + tag_matches:
        key = str(doc.id)
        if key not in seen:
            seen.add(key)
            results.append(doc)

    results.sort(key=lambda d: d.created_at, reverse=True)
    return [doc_with_tags(doc, db) for doc in results]
