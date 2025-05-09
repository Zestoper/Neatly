from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from models import Folder, Document, User
from routers.auth import get_current_user, get_db # get_current_user : 토큰으로 현재 사용자 확인
from pydantic import BaseModel

router = APIRouter()


# FolderCreate : 폴더 생성·수정 요청 시 받을 데이터 형식
class FolderCreate(BaseModel):
    name: str
    folder_type: str = "document"


def folder_to_dict(folder: Folder) -> dict:
    return {
        "id": str(folder.id),
        "name": folder.name,
        "folder_type": folder.folder_type,
        "created_at": folder.created_at,
    }


# GET /folders — 현재 사용자의 폴더 목록 반환 (folder_type으로 필터 가능)
@router.get("/folders")
def get_folders(
    folder_type: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    q = db.query(Folder).filter(Folder.user_id == current_user.id)
    if folder_type:
        q = q.filter(Folder.folder_type == folder_type)
    return [folder_to_dict(f) for f in q.order_by(Folder.created_at).all()]


# POST /folders — 새 폴더 생성
@router.post("/folders")
def create_folder(
    data: FolderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.plan == "FREE":
        raise HTTPException(status_code=403, detail="폴더 정리는 Standard 플랜부터 사용할 수 있어요.")

    folder = Folder(
        user_id=current_user.id,
        name=data.name,
        folder_type=data.folder_type,
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder_to_dict(folder)


# PATCH /folders/{folder_id} — 폴더 이름 수정
@router.patch("/folders/{folder_id}")
def update_folder(
    folder_id: str,
    data: FolderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    folder = db.query(Folder).filter(
        Folder.id == folder_id,
        Folder.user_id == current_user.id
    ).first()

    if not folder:
        raise HTTPException(status_code=404, detail="폴더를 찾을 수 없습니다.")

    folder.name = data.name
    db.commit()
    db.refresh(folder)
    return folder_to_dict(folder)


# DELETE /folders/{folder_id} — 폴더 삭제 (폴더만 삭제, 안의 문서는 folder_id가 null로 변함)
@router.delete("/folders/{folder_id}")
def delete_folder(
    folder_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    folder = db.query(Folder).filter(
        Folder.id == folder_id,
        Folder.user_id == current_user.id
    ).first()

    if not folder:
        raise HTTPException(status_code=404, detail="폴더를 찾을 수 없습니다.")

    # 폴더에 속한 문서의 folder_id를 먼저 NULL로 초기화
    # — FK 제약 조건상 폴더 삭제 전에 참조를 끊어야 DB 오류가 발생하지 않음
    db.query(Document).filter(Document.folder_id == folder_id).update(
        {"folder_id": None}
    )

    db.delete(folder)
    db.commit()
    return {"message": "폴더가 삭제되었습니다."}
