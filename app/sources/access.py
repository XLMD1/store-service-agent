from sqlalchemy import or_, select, update

from app.auth.service import now
from app.sources.models import Source, SourceReviewGrant


REVIEW_PERMISSIONS = {'service.read', 'service.draft'}


def active_review_grant(source_id, reviewer_id):
    return select(SourceReviewGrant.id).where(
        SourceReviewGrant.source_id == source_id, SourceReviewGrant.reviewer_id == reviewer_id,
        SourceReviewGrant.revoked_at.is_(None),
    )


def source_visible_to(user_id):
    return or_(Source.actor_id == user_id, active_review_grant(Source.id, user_id).exists())


def revoke_account_grants(db, user_id, *, include_submitted):
    affected = SourceReviewGrant.reviewer_id == user_id
    if include_submitted:
        affected = or_(affected, SourceReviewGrant.source_id.in_(
            select(Source.id).where(Source.actor_id == user_id)))
    db.execute(update(SourceReviewGrant).where(affected, SourceReviewGrant.revoked_at.is_(None))
               .values(revoked_at=now()))
