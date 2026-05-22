from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from models import CalendarEvent, User
from routers.auth import get_current_user
from database import get_db
from pydantic import BaseModel
from datetime import datetime, date, timezone

router = APIRouter(prefix="/calendar", tags=["calendar"])


class EventCreate(BaseModel):
    title: str
    description: str | None = None
    event_date: datetime


class EventUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    event_date: datetime | None = None


def _event_dict(ev: CalendarEvent) -> dict:
    return {
        "id": str(ev.id),
        "title": ev.title,
        "description": ev.description,
        "event_date": ev.event_date.isoformat(),
        "created_at": ev.created_at.isoformat(),
    }


@router.get("/events")
def list_events(
    year: int | None = None,
    month: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(CalendarEvent).filter(CalendarEvent.user_id == current_user.id)
    if year and month:
        from calendar import monthrange
        _, last_day = monthrange(year, month)
        start = datetime(year, month, 1)
        end = datetime(year, month, last_day, 23, 59, 59)
        q = q.filter(CalendarEvent.event_date >= start, CalendarEvent.event_date <= end)
    events = q.order_by(CalendarEvent.event_date).all()
    return [_event_dict(e) for e in events]


@router.get("/events/today")
def today_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = date.today()
    start = datetime(today.year, today.month, today.day, 0, 0, 0)
    end = datetime(today.year, today.month, today.day, 23, 59, 59)
    events = (
        db.query(CalendarEvent)
        .filter(
            CalendarEvent.user_id == current_user.id,
            CalendarEvent.event_date >= start,
            CalendarEvent.event_date <= end,
        )
        .order_by(CalendarEvent.event_date)
        .all()
    )
    return [_event_dict(e) for e in events]


@router.post("/events")
def create_event(
    body: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ev = CalendarEvent(
        user_id=current_user.id,
        title=body.title,
        description=body.description,
        event_date=body.event_date,
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return _event_dict(ev)


@router.put("/events/{event_id}")
def update_event(
    event_id: str,
    body: EventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ev = db.query(CalendarEvent).filter(
        CalendarEvent.id == event_id,
        CalendarEvent.user_id == current_user.id,
    ).first()
    if not ev:
        raise HTTPException(status_code=404, detail="이벤트를 찾을 수 없습니다.")
    if body.title is not None:
        ev.title = body.title
    if body.description is not None:
        ev.description = body.description
    if body.event_date is not None:
        ev.event_date = body.event_date
    db.commit()
    db.refresh(ev)
    return _event_dict(ev)


@router.delete("/events/{event_id}")
def delete_event(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ev = db.query(CalendarEvent).filter(
        CalendarEvent.id == event_id,
        CalendarEvent.user_id == current_user.id,
    ).first()
    if not ev:
        raise HTTPException(status_code=404, detail="이벤트를 찾을 수 없습니다.")
    db.delete(ev)
    db.commit()
    return {"message": "삭제되었습니다."}
