from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from models import Tag, DocumentTag, Document, User
from routers.auth import get_current_user, get_db

router = APIRouter()


class TagCreate(BaseModel):
    name: str  # name : 태그 이름


# GET /tags — 현재 사용자의 태그 목록 반환
@router.get("/tags")
def get_tags(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(Tag).filter(
        Tag.user_id == current_user.id
    ).order_by(Tag.created_at).all()


# POST /tags — 새 태그 생성 (같은 이름이 이미 있으면 기존 태그 반환)
@router.post("/tags")
def create_tag(
    data: TagCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="태그 이름을 입력해주세요.")

    # 같은 이름의 태그가 이미 있으면 생성하지 않고 기존 것을 반환
    # 이렇게 하면 프론트에서 "이미 있는 태그 이름"을 입력해도 중복 생성이 안 됨
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


# DELETE /tags/{tag_id} — 태그 삭제 (DocumentTag도 CASCADE로 자동 삭제됨)
@router.delete("/tags/{tag_id}")
def delete_tag(
    tag_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tag = db.query(Tag).filter(
        Tag.id == tag_id,
        Tag.user_id == current_user.id,  # 본인 태그만 삭제 가능
    ).first()
    if not tag:
        raise HTTPException(status_code=404, detail="태그를 찾을 수 없습니다.")

    db.delete(tag)
    db.commit()
    return {"message": "삭제되었습니다."}


# POST /documents/{document_id}/tags — 문서에 태그 추가
# 태그 이름을 받아서 없으면 자동 생성, 있으면 연결만 함
@router.post("/documents/{document_id}/tags")
def add_tag_to_document(
    document_id: str,
    data: TagCreate,  # data.name : 추가할 태그 이름
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 문서가 존재하고 내 것인지 확인
    doc = db.query(Document).filter(
        Document.id == document_id,
        Document.user_id == current_user.id,
        Document.deleted_at == None,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    # 태그가 없으면 생성, 있으면 기존 것 사용
    name = data.name.strip()
    tag = db.query(Tag).filter(
        Tag.user_id == current_user.id,
        Tag.name == name,
    ).first()
    if not tag:
        tag = Tag(user_id=current_user.id, name=name)
        db.add(tag)
        db.flush()  # flush : commit 전에 tag.id를 확정시켜서 아래 DocumentTag에서 쓸 수 있게 함

    # 이미 연결돼 있으면 중복 추가하지 않음
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


# DELETE /documents/{document_id}/tags/{tag_id} — 문서에서 태그 제거
@router.delete("/documents/{document_id}/tags/{tag_id}")
def remove_tag_from_document(
    document_id: str,
    tag_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 내 문서인지 확인
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
