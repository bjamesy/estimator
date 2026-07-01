from datetime import datetime, timezone

from estimator_workers.supabase_client import get_supabase


def start_event(document_id: str, stage: str, attempt_number: int) -> str:
    supabase = get_supabase()
    result = (
        supabase.table("document_processing_events")
        .insert(
            {
                "document_id": document_id,
                "stage": stage,
                "status": "started",
                "attempt_number": attempt_number,
                "started_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .execute()
    )
    return result.data[0]["id"]


def finish_event(event_id: str, status: str, error_message: str | None = None) -> None:
    supabase = get_supabase()
    supabase.table("document_processing_events").update(
        {
            "status": status,
            "error_message": error_message,
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", event_id).execute()


def mark_document_failed(document_id: str) -> None:
    supabase = get_supabase()
    supabase.table("documents").update({"status": "failed"}).eq("id", document_id).execute()
