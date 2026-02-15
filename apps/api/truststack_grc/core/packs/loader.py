from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from truststack_grc.config import get_settings
from truststack_grc.core.util.yamlio import read_yaml
from truststack_grc.core.packs.models import Pack, PackInfo, PackSource, ControlDefinition

@dataclass(frozen=True)
class PackPaths:
    root: Path
    packs_dir: Path

def _sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()

def _hash_dir(path: Path) -> str:
    h = hashlib.sha256()
    files = [p for p in path.rglob("*") if p.is_file()]
    for f in sorted(files, key=lambda p: str(p)):
        h.update(str(f.relative_to(path)).encode("utf-8"))
        h.update(b"\x00")
        h.update(f.read_bytes())
        h.update(b"\x00")
    return h.hexdigest()

class PackRegistry:
    def __init__(self, paths: PackPaths, schema_dir: Path):
        self.paths = paths
        self.schema_dir = schema_dir
        self._manifest_validator = Draft202012Validator(json.loads((schema_dir / "pack_manifest.schema.json").read_text(encoding="utf-8")))
        self._controls_validator = Draft202012Validator(json.loads((schema_dir / "controls.schema.json").read_text(encoding="utf-8")))

    @classmethod
    def from_env(cls) -> "PackRegistry":
        settings = get_settings()
        root = settings.config_root / "packs"
        return cls(
            paths=PackPaths(root=root, packs_dir=root),
            schema_dir=(settings.config_root.parent / "schemas"),
        )

    def list_packs(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        if not self.paths.packs_dir.exists():
            return out
        for domain_dir in sorted([d for d in self.paths.packs_dir.iterdir() if d.is_dir()], key=lambda p: p.name):
            domain = domain_dir.name
            for pack_dir in sorted([d for d in domain_dir.iterdir() if d.is_dir()], key=lambda p: p.name):
                versions = self.list_pack_versions(domain=domain, pack_id=pack_dir.name)
                if not versions:
                    continue
                entry: dict[str, Any] = {"domain": domain, "pack_id": pack_dir.name, "versions": versions}
                try:
                    latest = versions[-1]
                    loaded = self.load_pack(domain=domain, pack_id=pack_dir.name, version=latest)
                    if loaded:
                        entry["name"] = loaded.pack.name
                        entry["description"] = loaded.pack.description
                        entry["source"] = loaded.pack.source.model_dump()
                        if loaded.pack.extra.get("order") is not None:
                            entry["order"] = loaded.pack.extra.get("order")
                except Exception:
                    # Best-effort metadata for listing; keep folder discovery resilient.
                    pass
                out.append(entry)
        return out

    def list_pack_versions(self, domain: str, pack_id: str) -> list[str]:
        base = self.paths.packs_dir / domain / pack_id
        if not base.exists():
            return []
        return sorted([d.name for d in base.iterdir() if d.is_dir()])

    def load_pack(self, domain: str, pack_id: str, version: str) -> Pack | None:
        base = self.paths.packs_dir / domain / pack_id / version
        manifest_path = base / "pack.yaml"
        if not manifest_path.exists():
            return None
        manifest = read_yaml(manifest_path)
        self._manifest_validator.validate(manifest)

        pack_info_raw = manifest["pack"]
        source = pack_info_raw.get("source") or {}
        pack_info = PackInfo(
            id=pack_info_raw["id"],
            name=pack_info_raw["name"],
            version=pack_info_raw["version"],
            domain=pack_info_raw["domain"],
            type=pack_info_raw["type"],
            description=pack_info_raw.get("description"),
            license_hint=pack_info_raw.get("license_hint"),
            source=PackSource(name=source["name"], reference=source["reference"], url=source.get("url")),
            extra={k: v for k, v in pack_info_raw.items() if k not in {"id","name","version","domain","type","description","license_hint","source"}},
        )

        controls: list[ControlDefinition] = []
        controls_dir = base / "controls"
        if controls_dir.exists():
            for f in sorted(controls_dir.glob("*.yaml"), key=lambda p: p.name):
                cdoc = read_yaml(f)
                self._controls_validator.validate(cdoc)
                for c in cdoc.get("controls", []):
                    controls.append(ControlDefinition(**c))
        pack_hash = _hash_dir(base)

        return Pack(pack=pack_info, controls=controls, path=str(base), hash=pack_hash)
