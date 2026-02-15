from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from truststack_grc.config import get_settings
from truststack_grc.core.mapping.engine import generate_checklist, summarize
from truststack_grc.core.packs.loader import PackRegistry
from truststack_grc.core.storage.filesystem import FileSystemStorage
from truststack_grc.core.storage.hashing import sha256_text
from truststack_grc.core.taxonomy.loader import TaxonomyLoader
from truststack_grc.core.projects.context import build_context

ALLOWED_DEPLOYMENT_ENVIRONMENTS = {"AWS Native", "GCP Native", "Azure Native", "Custom Stack"}

def _slug(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or "project"

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _normalize_selected_llms(selected_llms: list[Any] | None) -> list[str]:
    if not selected_llms:
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for llm in selected_llms:
        text = str(llm).strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(text)
    return normalized

def _normalize_deployment_environment(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text not in ALLOWED_DEPLOYMENT_ENVIRONMENTS:
        raise ValueError(f"Unsupported deployment_environment: {text}")
    return text

class ProjectService:
    def __init__(self, storage: FileSystemStorage):
        self.storage = storage
        self.settings = get_settings()

    def create_project(self, req: dict[str, Any], actor: str) -> dict[str, Any]:
        taxonomy = TaxonomyLoader.from_env()
        uc = taxonomy.get_use_case(req["use_case_id"])
        if not uc:
            raise ValueError("Unknown use case")

        # Trust but verify: ensure selected industry/segment match the use-case definition
        if uc.get("industry", {}).get("id") != req["industry_id"] or uc.get("segment", {}).get("id") != req["segment_id"]:
            raise ValueError("industry_id/segment_id do not match the selected use_case_id")

        context = build_context(
            project_name=req["name"],
            industry_id=req["industry_id"],
            segment_id=req["segment_id"],
            use_case=uc,
            scope_answers=req.get("scope_answers") or {},
        )

        packs, normalized_selected_packs = self._load_packs(req.get("selected_packs", []))
        normalized_selected_llms = _normalize_selected_llms(req.get("selected_llms"))
        deployment_environment = _normalize_deployment_environment(req.get("deployment_environment"))
        if not deployment_environment:
            raise ValueError("deployment_environment is required")

        checklist = generate_checklist(context=context, packs=packs)

        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        project_id = f"{_slug(req['name'])}-{ts}"

        taxonomy_hash = sha256_text(str(taxonomy.list_industries()))
        packs_hash = sha256_text("|".join([f"{p.pack.domain}:{p.pack.id}:{p.pack.version}:{p.hash}" for p in packs]))
        checklist_hash = sha256_text(str([(i["merge_key"], i["severity"], i["title"]) for i in checklist["items"]]))

        project_doc = {
            "project": {
                "id": project_id,
                "name": req["name"],
                "description": req.get("description"),
                "created_at": utc_now(),
                "updated_at": utc_now(),
            },
            "inputs": {
                "industry_id": req["industry_id"],
                "segment_id": req["segment_id"],
                "use_case_id": req["use_case_id"],
                "deployment_environment": deployment_environment,
                "selected_llms": normalized_selected_llms,
                "selected_packs": normalized_selected_packs,
                "scope_answers": req.get("scope_answers", {}),
            },
            "context": context,
            "generated": {
                "generator_version": self.settings.generator_version,
                "taxonomy_hash": taxonomy_hash,
                "packs_hash": packs_hash,
                "checklist_hash": checklist_hash,
            },
        }

        checklist_doc = {
            "project_id": project_id,
            "generated_at": utc_now(),
            "items": checklist["items"],
            "counts": checklist["counts"],
        }

        self.storage.write_project(project_id, project_doc)
        self.storage.write_checklist(project_id, checklist_doc)
        self.storage.append_audit(project_id, "project.created", actor, {"project": {"id": project_id, "name": req["name"]}})

        return {"project": project_doc["project"], "project_id": project_id}

    def _load_packs(self, selected_packs: list[dict[str, Any]]) -> tuple[list[Any], list[dict[str, str]]]:
        reg = PackRegistry.from_env()
        loaded = []
        normalized = []
        for p in selected_packs:
            entry = {
                "domain": p["domain"],
                "pack_id": p["pack_id"],
                "version": p["version"],
            }
            pack = reg.load_pack(domain=entry["domain"], pack_id=entry["pack_id"], version=entry["version"])
            if not pack:
                raise ValueError(f"Unknown pack: {entry}")
            loaded.append(pack)
            normalized.append(entry)
        return loaded, normalized

    def update_checklist_item(self, project_id: str, item_id: str, patch: dict[str, Any], actor: str) -> dict[str, Any] | None:
        proj = self.storage.read_project(project_id)
        checklist = self.storage.read_checklist(project_id)
        if not proj or not checklist:
            return None

        items = checklist.get("items", [])
        found = None
        for it in items:
            if it.get("item_id") == item_id:
                found = it
                break
        if not found:
            return None

        before = {k: found.get(k) for k in ["status", "owner", "notes"]}
        for k in ["status", "owner", "notes"]:
            if k in patch:
                found[k] = patch[k]
        after = {k: found.get(k) for k in ["status", "owner", "notes"]}

        proj["project"]["updated_at"] = utc_now()
        self.storage.write_project(project_id, proj)
        self.storage.write_checklist(project_id, checklist)
        self.storage.append_audit(project_id, "checklist.item.updated", actor, {"item_id": item_id, "before": before, "after": after})
        return found

    def update_project(self, project_id: str, patch: dict[str, Any], actor: str) -> dict[str, Any] | None:
        proj = self.storage.read_project(project_id)
        if not proj:
            return None

        before = {
            "name": proj.get("project", {}).get("name"),
            "description": proj.get("project", {}).get("description"),
            "deployment_environment": proj.get("inputs", {}).get("deployment_environment"),
            "selected_llms": proj.get("inputs", {}).get("selected_llms", []),
            "selected_packs": proj.get("inputs", {}).get("selected_packs", []),
        }

        for key in {"name", "description"}:
            if key in patch:
                proj["project"][key] = patch[key]

        checklist_changed = False
        if "deployment_environment" in patch:
            deployment_environment = _normalize_deployment_environment(patch.get("deployment_environment"))
            proj.setdefault("inputs", {})["deployment_environment"] = deployment_environment

        if "selected_llms" in patch:
            normalized_selected_llms = _normalize_selected_llms(patch.get("selected_llms"))
            proj.setdefault("inputs", {})["selected_llms"] = normalized_selected_llms

        if "selected_packs" in patch:
            selected_packs = patch.get("selected_packs") or []
            packs, normalized_selected_packs = self._load_packs(selected_packs)
            context = proj.get("context", {})
            regenerated = generate_checklist(context=context, packs=packs)

            prior = self.storage.read_checklist(project_id) or {}
            prior_items = {it.get("item_id"): it for it in prior.get("items", [])}
            for item in regenerated["items"]:
                previous = prior_items.get(item.get("item_id"))
                if not previous:
                    continue
                for k in ["status", "owner", "notes", "evidence"]:
                    item[k] = previous.get(k)

            regenerated["counts"] = summarize(regenerated["items"])

            proj.setdefault("inputs", {})["selected_packs"] = normalized_selected_packs
            taxonomy = TaxonomyLoader.from_env()
            proj.setdefault("generated", {})["taxonomy_hash"] = sha256_text(str(taxonomy.list_industries()))
            proj["generated"]["packs_hash"] = sha256_text(
                "|".join([f"{p.pack.domain}:{p.pack.id}:{p.pack.version}:{p.hash}" for p in packs])
            )
            proj["generated"]["checklist_hash"] = sha256_text(
                str([(i["merge_key"], i["severity"], i["title"]) for i in regenerated["items"]])
            )

            checklist_doc = {
                "project_id": project_id,
                "generated_at": utc_now(),
                "items": regenerated["items"],
                "counts": regenerated["counts"],
            }
            self.storage.write_checklist(project_id, checklist_doc)
            checklist_changed = True

        proj["project"]["updated_at"] = utc_now()
        after = {
            "name": proj.get("project", {}).get("name"),
            "description": proj.get("project", {}).get("description"),
            "deployment_environment": proj.get("inputs", {}).get("deployment_environment"),
            "selected_llms": proj.get("inputs", {}).get("selected_llms", []),
            "selected_packs": proj.get("inputs", {}).get("selected_packs", []),
        }

        self.storage.write_project(project_id, proj)
        self.storage.append_audit(
            project_id,
            "project.updated",
            actor,
            {"before": before, "after": after, "checklist_regenerated": checklist_changed},
        )
        return proj

    def delete_project(self, project_id: str, actor: str) -> dict[str, Any] | None:
        proj = self.storage.read_project(project_id)
        if not proj:
            return None
        summary = {
            "project_id": project_id,
            "name": proj.get("project", {}).get("name"),
            "deleted_by": actor,
            "deleted_at": utc_now(),
        }
        deleted = self.storage.delete_project(project_id)
        if not deleted:
            return None
        return summary

    async def add_evidence(self, project_id: str, item_id: str, upload_file, actor: str) -> dict[str, Any] | None:
        proj = self.storage.read_project(project_id)
        checklist = self.storage.read_checklist(project_id)
        if not proj or not checklist:
            return None
        items = checklist.get("items", [])
        found = None
        for it in items:
            if it.get("item_id") == item_id:
                found = it
                break
        if not found:
            return None

        content = await upload_file.read()
        meta = self.storage.save_evidence_file(project_id, item_id, upload_file.filename or "upload.bin", content)
        meta.update({
            "content_type": upload_file.content_type,
            "uploaded_at": utc_now(),
        })
        found.setdefault("evidence", []).append(meta)

        proj["project"]["updated_at"] = utc_now()
        self.storage.write_project(project_id, proj)
        self.storage.write_checklist(project_id, checklist)
        self.storage.append_audit(project_id, "evidence.uploaded", actor, {"item_id": item_id, "file": meta})
        return meta
