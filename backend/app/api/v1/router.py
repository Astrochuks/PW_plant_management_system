"""API v1 router aggregating all endpoint routers."""

from fastapi import APIRouter

from app.api.v1 import (
    health,
    auth,
    plants,
    uploads,
    locations,
    fleet_types,
    spare_parts,
    reports,
    notifications,
    audit,
    purchase_orders,
)

api_router = APIRouter()

# Include all routers
api_router.include_router(health.router, prefix="/health", tags=["Health"])
api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(plants.router, prefix="/plants", tags=["Plants"])
api_router.include_router(uploads.router, prefix="/uploads", tags=["Uploads"])
api_router.include_router(locations.router, prefix="/locations", tags=["Locations"])
api_router.include_router(fleet_types.router, prefix="/fleet-types", tags=["Fleet Types"])
api_router.include_router(spare_parts.router, prefix="/spare-parts", tags=["Spare Parts"])
api_router.include_router(purchase_orders.router, prefix="/purchase-orders", tags=["Purchase Orders"])
api_router.include_router(reports.router, prefix="/reports", tags=["Reports"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])
api_router.include_router(audit.router, prefix="/audit", tags=["Audit"])

# Future routers to add:
# api_router.include_router(analytics.router, prefix="/analytics", tags=["Analytics"])
# api_router.include_router(ai.router, prefix="/ai", tags=["AI"])
