"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { createProject, fetchIndustries, fetchPacks } from "../../lib/api";
import { LLM_CATALOG } from "../../config/llms";

type SelectedPack = { domain: string; pack_id: string; version: string };
type PackDomainFilter = "all" | "governance" | "safety" | "security";
type DeploymentEnvironment = "AWS Native" | "GCP Native" | "Azure Native" | "Custom Stack";

const DEPLOYMENT_OPTIONS: DeploymentEnvironment[] = ["AWS Native", "GCP Native", "Azure Native", "Custom Stack"];

function latestVersion(versions: string[]) {
  return [...versions].sort().slice(-1)[0] || "";
}

export default function NewProjectPage() {
  const [industries, setIndustries] = useState<any[]>([]);
  const [packs, setPacks] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("My AI System");
  const [description, setDescription] = useState("");

  const [industryId, setIndustryId] = useState<string>("");
  const [segmentId, setSegmentId] = useState<string>("");
  const [useCaseId, setUseCaseId] = useState<string>("");

  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [selectedPacks, setSelectedPacks] = useState<Record<string, SelectedPack>>({}); // key=domain/pack_id
  const [selectedLlms, setSelectedLlms] = useState<string[]>([]);
  const [deploymentEnvironment, setDeploymentEnvironment] = useState<DeploymentEnvironment | "">("");
  const [llmQuery, setLlmQuery] = useState("");
  const [packDomainFilter, setPackDomainFilter] = useState<PackDomainFilter>("all");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerTitle, setViewerTitle] = useState("");
  const [viewerUrl, setViewerUrl] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [i, p] = await Promise.all([fetchIndustries(), fetchPacks()]);
        setIndustries(i.industries || []);
        setPacks(p.packs || []);
      } catch (e: any) {
        setErr(e.message || String(e));
      }
    })();
  }, []);

  const segments = useMemo(() => {
    const ind = industries.find((x) => x.id === industryId);
    return ind?.segments || [];
  }, [industries, industryId]);

  const useCases = useMemo(() => {
    const seg = segments.find((x: any) => x.id === segmentId);
    return seg?.use_cases || [];
  }, [segments, segmentId]);

  const useCase = useMemo(() => useCases.find((x: any) => x.id === useCaseId), [useCases, useCaseId]);
  const packsForDisplay = useMemo(() => {
    return [...packs].sort((a: any, b: any) => {
      if (a.domain !== b.domain) return String(a.domain).localeCompare(String(b.domain));
      const ao = Number(a.order ?? 9999);
      const bo = Number(b.order ?? 9999);
      if (ao !== bo) return ao - bo;
      return String(a.name || a.pack_id).localeCompare(String(b.name || b.pack_id));
    });
  }, [packs]);
  const packsByDomainCounts = useMemo(() => {
    const counts = { governance: 0, safety: 0, security: 0 };
    for (const p of packsForDisplay) {
      if (p.domain in counts) counts[p.domain as keyof typeof counts] += 1;
    }
    return counts;
  }, [packsForDisplay]);
  const filteredPacksForDisplay = useMemo(() => {
    if (packDomainFilter === "all") return packsForDisplay;
    return packsForDisplay.filter((p: any) => p.domain === packDomainFilter);
  }, [packsForDisplay, packDomainFilter]);
  const filteredLlms = useMemo(() => {
    const q = llmQuery.trim().toLowerCase();
    if (!q) return LLM_CATALOG;
    return LLM_CATALOG.filter((llm) => {
      return (
        llm.model.toLowerCase().includes(q) ||
        llm.developer.toLowerCase().includes(q) ||
        llm.popularityTier.toLowerCase().includes(q) ||
        llm.mainDriver.toLowerCase().includes(q)
      );
    });
  }, [llmQuery]);

  useEffect(() => {
    // reset downstream selections when parent changes
    setSegmentId("");
    setUseCaseId("");
    setAnswers({});
  }, [industryId]);

  useEffect(() => {
    setUseCaseId("");
    setAnswers({});
  }, [segmentId]);

  useEffect(() => {
    if (!useCase) return;
    const defaults: Record<string, any> = {};
    for (const q of (useCase.scope_questions || [])) {
      if (q.default !== undefined) defaults[q.id] = q.default;
    }
    setAnswers(defaults);
  }, [useCaseId]); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePack(domain: string, pack_id: string, versions: string[]) {
    const k = `${domain}/${pack_id}`;
    setSelectedPacks((prev) => {
      const next = {...prev};
      if (next[k]) delete next[k];
      else next[k] = { domain, pack_id, version: latestVersion(versions) };
      return next;
    });
  }

  function setPackVersion(domain: string, pack_id: string, version: string) {
    const k = `${domain}/${pack_id}`;
    setSelectedPacks((prev) => ({...prev, [k]: { domain, pack_id, version }}));
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

  function onChangeLlms(e: ChangeEvent<HTMLSelectElement>) {
    const models = Array.from(e.target.selectedOptions).map((opt) => opt.value);
    setSelectedLlms(models);
  }

  async function onCreate() {
    setErr(null);
    try {
      const payload = {
        name,
        description: description || null,
        industry_id: industryId,
        segment_id: segmentId,
        use_case_id: useCaseId,
        scope_answers: answers,
        deployment_environment: deploymentEnvironment,
        selected_llms: selectedLlms,
        selected_packs: Object.values(selectedPacks),
      };
      const res = await createProject(payload);
      const id = res.project_id;
      window.location.href = `/projects/${id}`;
    } catch (e: any) {
      setErr(e.message || String(e));
    }
  }

  const canCreate =
    industryId &&
    segmentId &&
    useCaseId &&
    deploymentEnvironment &&
    selectedLlms.length > 0 &&
    Object.values(selectedPacks).length > 0;

  return (
    <main className="container">
      <div className="card">
        <h2 style={{marginTop:0}}>Create Project</h2>
        <div className="small">
          Choose a use case, answer scoping questions, pick packs, and generate an audit-ready checklist.
        </div>

        {err && (
          <div className="card" style={{ marginTop: 12, borderColor: "#fecaca", background: "#fff1f2" }}>
            <div style={{ fontWeight: 700 }}>Error</div>
            <div className="small">{err}</div>
          </div>
        )}

        <hr />

        <div className="grid grid2">
          <div>
            <label>Project name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <label>Description (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            <label>Deployment environment</label>
            <select value={deploymentEnvironment} onChange={(e) => setDeploymentEnvironment(e.target.value as DeploymentEnvironment)}>
              <option value="">Select…</option>
              {DEPLOYMENT_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          <div>
            <label>Industry</label>
            <select value={industryId} onChange={(e) => setIndustryId(e.target.value)}>
              <option value="">Select…</option>
              {industries.map((ind) => (
                <option key={ind.id} value={ind.id}>{ind.name}</option>
              ))}
            </select>

            <label>Segment</label>
            <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} disabled={!industryId}>
              <option value="">Select…</option>
              {segments.map((seg: any) => (
                <option key={seg.id} value={seg.id}>{seg.name}</option>
              ))}
            </select>

            <label>Use case</label>
            <select value={useCaseId} onChange={(e) => setUseCaseId(e.target.value)} disabled={!segmentId}>
              <option value="">Select…</option>
              {useCases.map((uc: any) => (
                <option key={uc.id} value={uc.id}>{uc.name}</option>
              ))}
            </select>
          </div>
        </div>

        {useCase && (
          <>
            <hr />
            <h3 style={{marginTop:0}}>Scope</h3>
            <div className="small">{useCase.description}</div>
            <div className="grid grid2" style={{marginTop:8}}>
              {(useCase.scope_questions || []).map((q: any) => (
                <div key={q.id}>
                  <label>{q.prompt}</label>
                  {q.type === "boolean" && (
                    <select value={String(answers[q.id] ?? false)} onChange={(e) => setAnswers(a => ({...a, [q.id]: e.target.value === "true"}))}>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  )}
                  {q.type === "select" && (
                    <select value={answers[q.id] ?? ""} onChange={(e) => setAnswers(a => ({...a, [q.id]: e.target.value}))}>
                      {(q.options || []).map((opt: string) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  )}
                  {q.type === "multiselect" && (
                    <select
                      multiple
                      value={answers[q.id] ?? []}
                      onChange={(e) => {
                        const vals = Array.from(e.target.selectedOptions).map(o => o.value);
                        setAnswers(a => ({...a, [q.id]: vals}));
                      }}
                      size={Math.min(5, (q.options || []).length || 3)}
                    >
                      {(q.options || []).map((opt: string) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  )}
                  {q.type === "string" && (
                    <input value={answers[q.id] ?? ""} onChange={(e) => setAnswers(a => ({...a, [q.id]: e.target.value}))} />
                  )}
                  {q.type === "number" && (
                    <input type="number" value={answers[q.id] ?? ""} onChange={(e) => setAnswers(a => ({...a, [q.id]: Number(e.target.value)}))} />
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <hr />
        <h3 style={{marginTop:0}}>LLMs Used</h3>
        <div className="small">
          Select one or more models used in this project. This becomes part of the project record and reports.
        </div>
        <div className="grid grid2" style={{marginTop: 8}}>
          <div>
            <label>Search models</label>
            <input
              placeholder="Filter by model, developer, popularity, or driver"
              value={llmQuery}
              onChange={(e) => setLlmQuery(e.target.value)}
            />
            <label style={{marginTop: 8}}>Model selection ({selectedLlms.length} selected)</label>
            <select
              multiple
              size={12}
              value={selectedLlms}
              onChange={onChangeLlms}
            >
              {filteredLlms.map((llm) => (
                <option key={llm.model} value={llm.model}>
                  {llm.rank}. {llm.model} - {llm.developer} ({llm.popularityTier})
                </option>
              ))}
            </select>
            <div className="small" style={{marginTop: 6}}>
              Tip: use Ctrl/Cmd + click to select multiple entries.
            </div>
          </div>
          <div>
            <label>Selected models</label>
            {selectedLlms.length === 0 ? (
              <div className="small">No models selected yet.</div>
            ) : (
              <div className="grid">
                {selectedLlms.map((name) => {
                  const llm = LLM_CATALOG.find((x) => x.model === name);
                  return (
                    <div key={name} className="card" style={{padding: 10}}>
                      <div className="hstack" style={{justifyContent: "space-between"}}>
                        <div style={{fontWeight: 700}}>{name}</div>
                        <span className="badge">{llm?.popularityTier || "Unknown"}</span>
                      </div>
                      <div className="small">{llm?.developer || "Unknown developer"}</div>
                      <div className="small">{llm?.mainDriver || "No driver details available"}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <hr />
        <h3 style={{marginTop:0}}>Select Packs</h3>
        <div className="small">Choose one or more packs across Security/Safety/Governance.</div>
        <div className="hstack" style={{marginTop: 10}}>
          <button className={"btn " + (packDomainFilter === "all" ? "btnPrimary" : "")} onClick={() => setPackDomainFilter("all")} type="button">
            All ({packsForDisplay.length})
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

        <div className="grid" style={{marginTop:12}}>
          {filteredPacksForDisplay.map((p) => {
            const k = `${p.domain}/${p.pack_id}`;
            const checked = Boolean(selectedPacks[k]);
            const versions: string[] = p.versions || [];
            const sourceUrl = typeof p?.source?.url === "string" ? p.source.url : "";
            return (
              <div key={k} className="card" style={{padding:12}}>
                <div className="hstack" style={{justifyContent:"space-between"}}>
                  <div>
                    {sourceUrl ? (
                      <button
                        type="button"
                        className="linkButton"
                        style={{fontWeight:700}}
                        onClick={() => openStandardViewer(p.name || p.pack_id, sourceUrl)}
                      >
                        {p.name || p.pack_id}
                      </button>
                    ) : (
                      <div style={{fontWeight:700}}>{p.name || p.pack_id}</div>
                    )}
                    <div className="small"><span className="badge">{p.domain}</span> {versions.length} version(s)</div>
                  </div>
                  <button className={"btn " + (checked ? "btnDanger" : "btnPrimary")} onClick={() => togglePack(p.domain, p.pack_id, versions)}>
                    {checked ? "Remove" : "Add"}
                  </button>
                </div>
                {checked && (
                  <div style={{marginTop:10}}>
                    <label>Version</label>
                    <select value={selectedPacks[k].version} onChange={(e) => setPackVersion(p.domain, p.pack_id, e.target.value)}>
                      {versions.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                )}
              </div>
            );
          })}
          {filteredPacksForDisplay.length === 0 && (
            <div className="small">No packs available in this category.</div>
          )}
        </div>

        <hr />
        <div className="hstack" style={{justifyContent:"space-between"}}>
          <div className="small">
            {canCreate ? "Ready to generate a checklist." : "Select a use case, deployment environment, one or more LLMs, and at least one pack."}
          </div>
          <button className={"btn " + (canCreate ? "btnPrimary" : "")} disabled={!canCreate} onClick={onCreate}>
            Generate Checklist
          </button>
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
    </main>
  );
}
