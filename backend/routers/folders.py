from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from models import Folder, Document, User
from routers.auth import get_current_user, get_db
from pydantic import BaseModel

router = APIRouter()

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

    db.query(Document).filter(Document.folder_id == folder_id).update(
        {"folder_id": None}
    )

    db.delete(folder)
    db.commit()
    return {"message": "폴더가 삭제되었습니다."}
