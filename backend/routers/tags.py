from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from models import Tag, DocumentTag, Document, User
from routers.auth import get_current_user, get_db

router = APIRouter()

class TagCreate(BaseModel):
    name: str

@router.get("/tags")
def get_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(Tag).filter(
        Tag.user_id == current_user.id
    ).order_by(Tag.created_at).all()

@router.post("/tags")
def create_tag(
    data: TagCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="태그 이름을 입력해주세요.")

    existing = db.query(Tag).filter(
        Tag.user_id == current_user.id,
        Tag.name == name,
    ).first()
    if existing:
        return existing

    tag = Tag(user_id=current_user.id, name=name)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag

@router.delete("/tags/{tag_id}")
def delete_tag(
    tag_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tag = db.query(Tag).filter(
        Tag.id == tag_id,
        Tag.user_id == current_user.id,
    ).first()
    if not tag:
        raise HTTPException(status_code=404, detail="태그를 찾을 수 없습니다.")

    db.delete(tag)
    db.commit()
    return {"message": "삭제되었습니다."}

@router.post("/documents/{document_id}/tags")
def add_tag_to_document(
    document_id: str,
    data: TagCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    doc = db.query(Document).filter(
        Document.id == document_id,
        Document.user_id == current_user.id,
        Document.deleted_at == None,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    name = data.name.strip()
    tag = db.query(Tag).filter(
        Tag.user_id == current_user.id,
        Tag.name == name,
    ).first()
    if not tag:
        tag = Tag(user_id=current_user.id, name=name)
        db.add(tag)
        db.flush()

    already = db.query(DocumentTag).filter(
        DocumentTag.document_id == document_id,
        DocumentTag.tag_id == tag.id,
    ).first()
    if already:
        return {"id": str(tag.id), "name": tag.name}

    link = DocumentTag(document_id=document_id, tag_id=tag.id)
    db.add(link)
    db.commit()

    return {"id": str(tag.id), "name": tag.name}

@router.delete("/documents/{document_id}/tags/{tag_id}")
def remove_tag_from_document(
    document_id: str,
    tag_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    doc = db.query(Document).filter(
        Document.id == document_id,
        Document.user_id == current_user.id,
        Document.deleted_at == None,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    link = db.query(DocumentTag).filter(
        DocumentTag.document_id == document_id,
        DocumentTag.tag_id == tag_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="태그가 연결되어 있지 않습니다.")

    db.delete(link)
    db.commit()
    return {"message": "태그가 제거되었습니다."}
