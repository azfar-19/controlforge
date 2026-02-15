"use client";

import { useEffect, useMemo, useState } from "react";
import { deleteProject, fetchChecklist, fetchPack, fetchPacks, fetchProject, patchChecklistItem, patchProject, reportUrl, uploadEvidence } from "../../../lib/api";

const STATUS = ["not_started", "in_progress", "implemented", "not_applicable", "risk_accepted"];
type SelectedPack = { domain: string; pack_id: string; version: string };
type PackDomainFilter = "all" | "governance" | "safety" | "security";
type PackDetail = {
  pack: {
    id: string;
    name: string;
    version: string;
    domain: string;
    description?: string;
    source?: { name?: string; reference?: string; url?: string };
  };
};

function packKey(domain: string, packId: string) {
  return `${domain}/${packId}`;
}

function latestVersion(versions: string[]) {
  return [...versions].sort().slice(-1)[0] || "";
}

function normalizePackSelection(packs: SelectedPack[]) {
  return packs
    .map((p) => `${p.domain}|${p.pack_id}|${p.version}`)
    .sort()
    .join("||");
}

function packVersionKey(domain: string, packId: string, version: string) {
  return `${domain}/${packId}/${version}`;
}

function sevBadge(sev: string) {
  const styles: Record<string, React.CSSProperties> = {
    critical: { borderColor: "#fecaca", background: "#fff1f2", color: "#7f1d1d" },
    high: { borderColor: "#fed7aa", background: "#fff7ed", color: "#7c2d12" },
    medium: { borderColor: "#bfdbfe", background: "#eff6ff", color: "#1e3a8a" },
    low: { borderColor: "#e2e8f0", background: "#f8fafc", color: "#0f172a" }
  };
  return <span className="badge" style={styles[sev] || {}}>{sev}</span>;
}

export default function ProjectPage({ params }: { params: { projectId: string } }) {
  const projectId = params.projectId;
  const [project, setProject] = useState<any | null>(null);
  const [checklist, setChecklist] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const [packCatalog, setPackCatalog] = useState<any[]>([]);
  const [selectedPacks, setSelectedPacks] = useState<Record<string, SelectedPack>>({});
  const [packDetails, setPackDetails] = useState<Record<string, PackDetail>>({});
  const [packDomainFilter, setPackDomainFilter] = useState<PackDomainFilter>("all");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerTitle, setViewerTitle] = useState("");
  const [viewerUrl, setViewerUrl] = useState("");

  async function refresh() {
    setErr(null);
    try {
      const [p, c] = await Promise.all([fetchProject(projectId), fetchChecklist(projectId)]);
      setProject(p);
      setChecklist(c);
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  useEffect(() => { refresh(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchPacks();
        setPackCatalog(res.packs || []);
      } catch (e: any) {
        setErr(e.message || String(e));
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const latestTargets = (packCatalog || [])
        .map((p) => {
          const versions: string[] = p.versions || [];
          const version = latestVersion(versions);
          if (!version) return null;
          return { domain: p.domain, pack_id: p.pack_id, version };
        })
        .filter(Boolean) as SelectedPack[];
      const missing = latestTargets.filter((p) => !packDetails[packVersionKey(p.domain, p.pack_id, p.version)]);
      if (missing.length === 0) return;
      try {
        const loaded = await Promise.all(
          missing.map((p) => fetchPack(p.domain, p.pack_id, p.version))
        );
        setPackDetails((prev) => {
          const next = { ...prev };
          loaded.forEach((d: PackDetail) => {
            const k = packVersionKey(d.pack.domain, d.pack.id, d.pack.version);
            next[k] = d;
          });
          return next;
        });
      } catch {
        // Non-blocking; informational links are best-effort.
      }
    })();
  }, [packCatalog, packDetails]);

  useEffect(() => {
    (async () => {
      const targets = Object.values(selectedPacks);
      const missing = targets.filter((p) => !packDetails[packVersionKey(p.domain, p.pack_id, p.version)]);
      if (missing.length === 0) return;
      try {
        const loaded = await Promise.all(
          missing.map((p) => fetchPack(p.domain, p.pack_id, p.version))
        );
        setPackDetails((prev) => {
          const next = { ...prev };
          loaded.forEach((d: PackDetail) => {
            const k = packVersionKey(d.pack.domain, d.pack.id, d.pack.version);
            next[k] = d;
          });
          return next;
        });
      } catch {
        // Non-blocking; the page still works without educational metadata.
      }
    })();
  }, [selectedPacks, packDetails]);

  useEffect(() => {
    const p = project?.project;
    if (!p) return;
    setEditName(p.name || "");
    setEditDescription(p.description || "");
    const current = (project?.inputs?.selected_packs || []) as SelectedPack[];
    const next: Record<string, SelectedPack> = {};
    for (const sp of current) {
      next[packKey(sp.domain, sp.pack_id)] = sp;
    }
    setSelectedPacks(next);
  }, [project?.project?.id, project?.project?.updated_at, project?.inputs?.selected_packs]);

  const counts = checklist?.counts || {};
  const items: any[] = checklist?.items || [];

  const progress = useMemo(() => {
    const total = counts.total || items.length || 0;
    const implemented = (counts.by_status?.implemented) || items.filter(i => i.status === "implemented").length;
    return total ? Math.round((implemented / total) * 100) : 0;
  }, [counts, items]);

  const currentName = project?.project?.name || "";
  const currentDescription = project?.project?.description || "";
  const deploymentEnvironment: string = project?.inputs?.deployment_environment || "Not specified";
  const selectedLlms: string[] = project?.inputs?.selected_llms || [];
  const currentSelectedPackList = ((project?.inputs?.selected_packs || []) as SelectedPack[]);
  const selectedPackList = useMemo(() => Object.values(selectedPacks), [selectedPacks]);
  const packsChanged = normalizePackSelection(selectedPackList) !== normalizePackSelection(currentSelectedPackList);
  const canSaveProject =
    Boolean(editName.trim()) &&
    (editName.trim() !== currentName || editDescription !== currentDescription || packsChanged);

  const knownPackKeys = useMemo(
    () => new Set(packCatalog.map((p) => packKey(p.domain, p.pack_id))),
    [packCatalog]
  );
  const unavailableSelectedPacks = selectedPackList.filter((p) => !knownPackKeys.has(packKey(p.domain, p.pack_id)));
  const packCatalogForDisplay = useMemo(() => {
    return [...packCatalog].sort((a, b) => {
      if (a.domain !== b.domain) return String(a.domain).localeCompare(String(b.domain));
      const ao = Number(a.order ?? 9999);
      const bo = Number(b.order ?? 9999);
      if (ao !== bo) return ao - bo;
      return String(a.name || a.pack_id).localeCompare(String(b.name || b.pack_id));
    });
  }, [packCatalog]);
  const packsByDomainCounts = useMemo(() => {
    const counts = { governance: 0, safety: 0, security: 0 };
    for (const p of packCatalogForDisplay) {
      if (p.domain in counts) counts[p.domain as keyof typeof counts] += 1;
    }
    return counts;
  }, [packCatalogForDisplay]);
  const filteredPackCatalogForDisplay = useMemo(() => {
    if (packDomainFilter === "all") return packCatalogForDisplay;
    return packCatalogForDisplay.filter((p) => p.domain === packDomainFilter);
  }, [packCatalogForDisplay, packDomainFilter]);
  const educationalByDomain = useMemo(() => {
    const domainText: Record<string, string> = {
      governance: "Governance packs cover regulatory obligations, accountability, and risk management frameworks.",
      safety: "Safety packs focus on model behavior, documentation, monitoring, and harm mitigation controls.",
      security: "Security packs address threats, vulnerabilities, and protective controls for AI systems and data.",
    };
    const grouped: Record<string, Array<{ domain: string; pack_id: string; version: string; detail?: PackDetail }>> = {
      governance: [],
      safety: [],
      security: [],
    };

    for (const p of packCatalogForDisplay) {
      const versions: string[] = p.versions || [];
      const version = latestVersion(versions);
      if (!version) continue;
      const d = packDetails[packVersionKey(p.domain, p.pack_id, version)];
      if (!grouped[p.domain]) grouped[p.domain] = [];
      grouped[p.domain].push({ domain: p.domain, pack_id: p.pack_id, version, detail: d });
    }

    return [
      { domain: "governance", title: "Governance Standards", intro: domainText.governance, items: grouped.governance || [] },
      { domain: "safety", title: "Safety Standards", intro: domainText.safety, items: grouped.safety || [] },
      { domain: "security", title: "Security Standards", intro: domainText.security, items: grouped.security || [] },
    ];
  }, [packCatalogForDisplay, packDetails]);

  async function saveSelectedPacks(nextSelectedPacks: SelectedPack[]) {
    setErr(null);
    setSavingProject(true);
    try {
      await patchProject(projectId, { selected_packs: nextSelectedPacks });
      await refresh();
    } catch (e: any) {
      setErr(e.message || String(e));
      await refresh();
    } finally {
      setSavingProject(false);
    }
  }

  async function togglePack(domain: string, pack_id: string, versions: string[]) {
    const key = packKey(domain, pack_id);
    const next = { ...selectedPacks };
    if (next[key]) {
      delete next[key];
    } else {
      next[key] = { domain, pack_id, version: latestVersion(versions) };
    }
    setSelectedPacks(next);
    await saveSelectedPacks(Object.values(next));
  }

  async function setPackVersion(domain: string, pack_id: string, version: string) {
    const key = packKey(domain, pack_id);
    const next = { ...selectedPacks, [key]: { domain, pack_id, version } };
    setSelectedPacks(next);
    await saveSelectedPacks(Object.values(next));
  }

  function openStandardViewer(title: string, url?: string) {
    if (!url) return;
    setViewerTitle(title);
    setViewerUrl(url);
    setViewerOpen(true);
  }

  function closeStandardViewer() {
    setViewerOpen(false);
  }

  async function onSaveProject() {
    setErr(null);
    setSavingProject(true);
    try {
      await patchProject(projectId, {
        name: editName.trim(),
        description: editDescription.trim() ? editDescription.trim() : null,
        selected_packs: selectedPackList,
      });
      await refresh();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setSavingProject(false);
    }
  }

  async function onDeleteProject() {
    const nameForPrompt = project?.project?.name || projectId;
    if (!window.confirm(`Delete project "${nameForPrompt}"? This action cannot be undone.`)) {
      return;
    }
    setErr(null);
    setDeletingProject(true);
    try {
      await deleteProject(projectId);
      window.location.href = "/getting-started";
    } catch (e: any) {
      setErr(e.message || String(e));
      setDeletingProject(false);
    }
  }

  async function updateItem(itemId: string, patch: any) {
    setBusy(itemId);
    try {
      await patchChecklistItem(projectId, itemId, patch);
      await refresh();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onUpload(itemId: string, file: File) {
    setBusy(itemId);
    try {
      await uploadEvidence(projectId, itemId, file);
      await refresh();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="container">
      <div className="card">
        <div className="hstack" style={{justifyContent:"space-between"}}>
          <div>
            <div style={{fontWeight:800, fontSize:18}}>{project?.project?.name || projectId}</div>
            <div className="small">
              Use case: <code>{project?.inputs?.use_case_id}</code> · Packs: {(project?.inputs?.selected_packs || []).length}
            </div>
            <div className="small">
              Deployment: {deploymentEnvironment}
            </div>
            <div className="small">
              LLMs: {selectedLlms.length === 0 ? "Not specified" : selectedLlms.join(", ")}
            </div>
          </div>
          <div className="hstack">
            <a className="btn" href={reportUrl(projectId, "html")} target="_blank" rel="noreferrer">View Report (HTML)</a>
            <a className="btn" href={reportUrl(projectId, "csv")} target="_blank" rel="noreferrer">Export CSV</a>
            <a className="btn" href={reportUrl(projectId, "pdf")} target="_blank" rel="noreferrer">Export PDF</a>
          </div>
        </div>

        {err && (
          <div className="card" style={{ marginTop: 12, borderColor: "#fecaca", background: "#fff1f2" }}>
            <div style={{ fontWeight: 700 }}>Error</div>
            <div className="small">{err}</div>
          </div>
        )}

        <hr />
        <div className="grid grid2" style={{marginBottom: 12}}>
          <div>
            <label>Project name</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              disabled={savingProject || deletingProject}
            />
          </div>
          <div>
            <label>Description</label>
            <textarea
              rows={2}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              disabled={savingProject || deletingProject}
            />
          </div>
        </div>

        <hr />
        <h3 style={{marginTop: 0}}>Selected Packs</h3>
        <div className="small">
          Add, remove, or change pack versions. Checklist updates immediately while keeping progress for unchanged controls.
        </div>
        <div className="hstack" style={{marginTop: 10}}>
          <button className={"btn " + (packDomainFilter === "all" ? "btnPrimary" : "")} onClick={() => setPackDomainFilter("all")} type="button">
            All ({packCatalogForDisplay.length})
          </button>
          <button className={"btn " + (packDomainFilter === "governance" ? "btnPrimary" : "")} onClick={() => setPackDomainFilter("governance")} type="button">
            Governance ({packsByDomainCounts.governance})
          </button>
          <button className={"btn " + (packDomainFilter === "safety" ? "btnPrimary" : "")} onClick={() => setPackDomainFilter("safety")} type="button">
            Safety ({packsByDomainCounts.safety})
          </button>
          <button className={"btn " + (packDomainFilter === "security" ? "btnPrimary" : "")} onClick={() => setPackDomainFilter("security")} type="button">
            Security ({packsByDomainCounts.security})
          </button>
        </div>
        <div className="grid" style={{marginTop: 12, marginBottom: 12}}>
          {filteredPackCatalogForDisplay.map((p) => {
            const key = packKey(p.domain, p.pack_id);
            const checked = Boolean(selectedPacks[key]);
            const versions: string[] = p.versions || [];
            const sourceUrl = typeof p?.source?.url === "string" ? p.source.url : "";
            return (
              <div key={key} className="card" style={{padding: 12}}>
                <div className="hstack" style={{justifyContent: "space-between"}}>
                  <div>
                    {sourceUrl ? (
                      <button
                        type="button"
                        className="linkButton"
                        style={{fontWeight: 700}}
                        onClick={() => openStandardViewer(p.name || p.pack_id, sourceUrl)}
                      >
                        {p.name || p.pack_id}
                      </button>
                    ) : (
                      <div style={{fontWeight: 700}}>{p.name || p.pack_id}</div>
                    )}
                    <div className="small"><span className="badge">{p.domain}</span> {versions.length} version(s)</div>
                  </div>
                  <button
                    className={"btn " + (checked ? "btnDanger" : "btnPrimary")}
                    onClick={() => togglePack(p.domain, p.pack_id, versions)}
                    disabled={savingProject || deletingProject}
                  >
                    {checked ? "Remove" : "Add"}
                  </button>
                </div>
                {checked && (
                  <div style={{marginTop: 10}}>
                    <label>Version</label>
                    <select
                      value={selectedPacks[key].version}
                      onChange={(e) => setPackVersion(p.domain, p.pack_id, e.target.value)}
                      disabled={savingProject || deletingProject}
                    >
                      {versions.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                )}
              </div>
            );
          })}
          {filteredPackCatalogForDisplay.length === 0 && (
            <div className="small">No packs available in this category.</div>
          )}
        </div>

        {unavailableSelectedPacks.length > 0 && (
          <div className="card" style={{marginBottom: 12, borderColor: "#fed7aa", background: "#fff7ed"}}>
            <div style={{fontWeight: 700, marginBottom: 6}}>Unavailable selected packs</div>
            <div className="small" style={{marginBottom: 8}}>
              These packs are currently selected in this project but were not found in the pack registry.
            </div>
            <div className="grid">
              {unavailableSelectedPacks.map((sp) => (
                <div key={packKey(sp.domain, sp.pack_id)} className="hstack" style={{justifyContent: "space-between"}}>
                  <div className="small">
                    <code>{sp.domain}/{sp.pack_id}</code> · version <code>{sp.version}</code>
                  </div>
                  <button
                    className="btn btnDanger"
                    onClick={() => togglePack(sp.domain, sp.pack_id, [sp.version])}
                    disabled={savingProject || deletingProject}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <hr />
        <h3 style={{marginTop: 0}}>Pack Learning Center</h3>
        <div className="small" style={{marginBottom: 10}}>
          Learn what each standard covers and open the source publication for deeper guidance.
        </div>
        <div className="grid" style={{marginBottom: 12}}>
          {educationalByDomain.map((group) => (
            <div key={group.domain} className="card" style={{padding: 12}}>
              <h4 style={{margin: 0}}>{group.title}</h4>
              <div className="small" style={{marginTop: 4, marginBottom: 8}}>{group.intro}</div>
              <div className="grid">
                {group.items.map((it) => {
                  const meta = it.detail?.pack;
                  const source = meta?.source || {};
                  const title = meta?.name || it.pack_id;
                  return (
                    <div key={`${it.domain}/${it.pack_id}/${it.version}`} className="card" style={{padding: 12}}>
                      <div className="hstack" style={{justifyContent: "space-between"}}>
                        {source.url ? (
                          <button
                            type="button"
                            className="linkButton"
                            style={{fontWeight: 700}}
                            onClick={() => openStandardViewer(title, source.url)}
                          >
                            {title}
                          </button>
                        ) : (
                          <div style={{fontWeight: 700}}>{title}</div>
                        )}
                        <span className="badge">{it.version}</span>
                      </div>
                      <div className="small" style={{marginTop: 6}}>
                        {meta?.description || "Standard pack for this domain."}
                      </div>
                      <div className="small" style={{marginTop: 8}}>
                        <strong>Source:</strong> {source.name || "Reference"}{source.reference ? ` - ${source.reference}` : ""}
                      </div>
                      <div className="hstack" style={{marginTop: 8}}>
                        {source.url ? (
                          <a className="btn" href={source.url} target="_blank" rel="noreferrer">Learn More</a>
                        ) : (
                          <span className="small">No public source URL provided.</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {group.items.length === 0 && (
                  <div className="small">No {group.domain} packs available in the registry.</div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="hstack" style={{justifyContent: "space-between"}}>
          <div className="small">
            Modify project details and selected packs. Delete permanently removes project files and evidence.
          </div>
          <div className="hstack">
            <button
              className={"btn " + (canSaveProject ? "btnPrimary" : "")}
              disabled={!canSaveProject || savingProject || deletingProject}
              onClick={onSaveProject}
            >
              {savingProject ? "Saving..." : "Save Project"}
            </button>
            <button
              className="btn btnDanger"
              disabled={savingProject || deletingProject}
              onClick={onDeleteProject}
            >
              {deletingProject ? "Deleting..." : "Delete Project"}
            </button>
          </div>
        </div>

        <hr />
        <div className="hstack">
          <span className="badge">Progress: {progress}%</span>
          <span className="badge">Total: {counts.total ?? items.length}</span>
          {counts.by_domain && Object.entries(counts.by_domain).map(([d, n]: any) => (
            <span key={d} className="badge">{d}: {n}</span>
          ))}
        </div>
      </div>

      {viewerOpen && (
        <div className="modalBackdrop" role="presentation" onClick={closeStandardViewer}>
          <div
            className="modalCard"
            role="dialog"
            aria-modal="true"
            aria-label={viewerTitle || "Standard Viewer"}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modalHeader">
              <h3>{viewerTitle}</h3>
              <div className="hstack">
                <a className="btn" href={viewerUrl} target="_blank" rel="noreferrer">Open in New Tab</a>
                <button className="btn btnDanger" type="button" onClick={closeStandardViewer}>Close</button>
              </div>
            </div>
            <div className="small" style={{marginBottom: 8}}>
              If the source site blocks embedding, use "Open in New Tab".
            </div>
            <iframe
              title={viewerTitle || "Standard Viewer"}
              src={viewerUrl}
              className="modalFrame"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      )}

      <div className="card" style={{marginTop:16}}>
        <div className="hstack" style={{justifyContent:"space-between"}}>
          <h2 style={{margin:0}}>Checklist</h2>
          <button className="btn" onClick={refresh}>Refresh</button>
        </div>
        <div className="small">Update status/owner/notes and attach evidence per control.</div>

        <div style={{overflow:"auto", marginTop:12, maxHeight:"68vh"}}>
          <table>
            <thead>
              <tr>
                <th>Domain</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Control</th>
                <th>Owner</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.item_id}>
                  <td><span className="badge">{it.domain}</span></td>
                  <td>{sevBadge(it.severity)}</td>
                  <td style={{minWidth:170}}>
                    <select
                      value={it.status}
                      disabled={busy === it.item_id}
                      onChange={(e) => updateItem(it.item_id, { status: e.target.value })}
                    >
                      {STATUS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={{minWidth:380}}>
                    <div style={{fontWeight:700}}>{it.title}</div>
                    <div className="small">{it.objective}</div>
                    {it.why_applies && <details style={{marginTop:8}}>
                      <summary className="small">Why it applies</summary>
                      <pre className="small" style={{whiteSpace:"pre-wrap"}}>{it.why_applies}</pre>
                    </details>}
                    <details style={{marginTop:8}}>
                      <summary className="small">Expected evidence</summary>
                      <ul className="small">
                        {(it.evidence_required || []).map((e: any, idx: number) => (
                          <li key={idx}>{e.type} — {e.name}</li>
                        ))}
                      </ul>
                    </details>
                  </td>
                  <td style={{minWidth:220}}>
                    <input
                      value={it.owner || ""}
                      placeholder="Owner"
                      disabled={busy === it.item_id}
                      onChange={(e) => updateItem(it.item_id, { owner: e.target.value })}
                    />
                    <textarea
                      style={{marginTop:8}}
                      rows={3}
                      placeholder="Notes / implementation record"
                      value={it.notes || ""}
                      disabled={busy === it.item_id}
                      onChange={(e) => updateItem(it.item_id, { notes: e.target.value })}
                    />
                  </td>
                  <td style={{minWidth:240}}>
                    <div className="small">{(it.evidence || []).length} file(s)</div>
                    <input
                      type="file"
                      disabled={busy === it.item_id}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onUpload(it.item_id, f);
                      }}
                    />
                    <ul className="small">
                      {(it.evidence || []).slice(0, 3).map((ev: any) => (
                        <li key={ev.sha256}>{ev.file_name} <span style={{opacity:0.7}}>({ev.sha256.slice(0,10)}…)</span></li>
                      ))}
                      {(it.evidence || []).length > 3 && <li>…</li>}
                    </ul>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="small">No controls generated. Adjust packs/scoping.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
