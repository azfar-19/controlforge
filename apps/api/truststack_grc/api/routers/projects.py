from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, UploadFile, File, Header
from pydantic import BaseModel, Field

from truststack_grc.core.projects.service import ProjectService
from truststack_grc.core.storage.filesystem import FileSystemStorage

router = APIRouter()

class SelectedPack(BaseModel):
    domain: str
    pack_id: str
    version: str

class CreateProjectRequest(BaseModel):
    name: str = Field(..., examples=["Claims Assistant - Pilot"])
    description: str | None = None
    industry_id: str
    segment_id: str
    use_case_id: str
    deployment_environment: Literal["AWS Native", "GCP Native", "Azure Native", "Custom Stack"]
    scope_answers: dict[str, Any] = Field(default_factory=dict)
    selected_llms: list[str] = Field(default_factory=list)
    selected_packs: list[SelectedPack]

class PatchProjectRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    deployment_environment: Literal["AWS Native", "GCP Native", "Azure Native", "Custom Stack"] | None = None
    selected_llms: list[str] | None = None
    selected_packs: list[SelectedPack] | None = None

@router.get("")
def list_projects():
    storage = FileSystemStorage.from_env()
    return {"projects": storage.list_projects()}

@router.get("/{project_id}")
def get_project(project_id: str):
    storage = FileSystemStorage.from_env()
    proj = storage.read_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj

@router.get("/{project_id}/checklist")
def get_checklist(project_id: str):
    storage = FileSystemStorage.from_env()
    checklist = storage.read_checklist(project_id)
    if not checklist:
        raise HTTPException(status_code=404, detail="Checklist not found")
    return checklist

@router.post("")
def create_project(req: CreateProjectRequest, x_user: str | None = Header(default=None)):
    storage = FileSystemStorage.from_env()
    service = ProjectService(storage=storage)
    created = service.create_project(req.model_dump(), actor=x_user or "anonymous")
    return created

@router.patch("/{project_id}")
def patch_project(project_id: str, req: PatchProjectRequest, x_user: str | None = Header(default=None)):
    storage = FileSystemStorage.from_env()
    service = ProjectService(storage=storage)
    patch = req.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(status_code=400, detail="No fields provided to update")
    if "name" in patch:
        name = (patch.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Project name cannot be empty")
        patch["name"] = name
    if "description" in patch and isinstance(patch["description"], str):
        patch["description"] = patch["description"].strip() or None
    try:
        updated = service.update_project(project_id, patch, actor=x_user or "anonymous")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found")
    return updated

@router.delete("/{project_id}")
def delete_project(project_id: str, x_user: str | None = Header(default=None)):
    storage = FileSystemStorage.from_env()
    service = ProjectService(storage=storage)
    deleted = service.delete_project(project_id, actor=x_user or "anonymous")
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found")
    return deleted

class PatchChecklistItemRequest(BaseModel):
    status: str | None = Field(default=None, description="not_started|in_progress|implemented|not_applicable|risk_accepted")
    owner: str | None = None
    notes: str | None = None

@router.patch("/{project_id}/checklist/{item_id}")
def patch_checklist_item(project_id: str, item_id: str, req: PatchChecklistItemRequest, x_user: str | None = Header(default=None)):
    storage = FileSystemStorage.from_env()
    service = ProjectService(storage=storage)
    updated = service.update_checklist_item(project_id, item_id, req.model_dump(exclude_none=True), actor=x_user or "anonymous")
    if not updated:
        raise HTTPException(status_code=404, detail="Project or item not found")
    return updated

@router.post("/{project_id}/evidence/{item_id}")
async def upload_evidence(project_id: str, item_id: str, file: UploadFile = File(...), x_user: str | None = Header(default=None)):
    storage = FileSystemStorage.from_env()
    service = ProjectService(storage=storage)
    res = await service.add_evidence(project_id, item_id, file, actor=x_user or "anonymous")
    if not res:
        raise HTTPException(status_code=404, detail="Project or item not found")
    return res
