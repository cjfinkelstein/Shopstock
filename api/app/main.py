from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import (
    auth_routes, dashboard, estimates, expenses, items, jobs, labels, reports, stock, time_clock, transactions,
    trucks, users, vendors,
)

app = FastAPI(
    title=f"{settings.app_name} API",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api/v1")


@api.get("/health")
def health():
    return {"status": "ok", "app": settings.app_name}


for r in (auth_routes.router, users.router, trucks.router, vendors.router, items.router,
          labels.router, jobs.router, transactions.router, stock.router, reports.router,
          dashboard.router, estimates.router, time_clock.router, expenses.router):
    api.include_router(r)

app.include_router(api)
