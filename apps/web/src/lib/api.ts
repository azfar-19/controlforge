export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API ${res.status}: ${txt}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchIndustries() {
  return j<{industries:any[]}>(await fetch(`${API_BASE}/api/taxonomy/industries`, { cache: "no-store" }));
}

export async function fetchPacks() {
  return j<{packs:any[]}>(await fetch(`${API_BASE}/api/packs`, { cache: "no-store" }));
}

export async function fetchPack(domain: string, packId: string, version: string) {
  return j<any>(await fetch(`${API_BASE}/api/packs/${domain}/${packId}/${version}`, { cache: "no-store" }));
}

export async function fetchProjects() {
  return j<{projects:any[]}>(await fetch(`${API_BASE}/api/projects`, { cache: "no-store" }));
}

export async function createProject(payload: any) {
  return j<any>(await fetch(`${API_BASE}/api/projects`, {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify(payload),
  }));
}

export async function fetchProject(projectId: string) {
  return j<any>(await fetch(`${API_BASE}/api/projects/${projectId}`, { cache: "no-store" }));
}

export async function patchProject(
  projectId: string,
  patch: {
    name?: string;
    description?: string | null;
    deployment_environment?: "AWS Native" | "GCP Native" | "Azure Native" | "Custom Stack" | null;
    selected_llms?: string[];
    selected_packs?: Array<{ domain: string; pack_id: string; version: string }>;
  }
) {
  return j<any>(await fetch(`${API_BASE}/api/projects/${projectId}`, {
    method: "PATCH",
    headers: {"content-type":"application/json"},
    body: JSON.stringify(patch),
  }));
}

export async function deleteProject(projectId: string) {
  return j<any>(await fetch(`${API_BASE}/api/projects/${projectId}`, {
    method: "DELETE",
  }));
}

export async function fetchChecklist(projectId: string) {
  return j<any>(await fetch(`${API_BASE}/api/projects/${projectId}/checklist`, { cache: "no-store" }));
}

export async function patchChecklistItem(projectId: string, itemId: string, patch: any) {
  return j<any>(await fetch(`${API_BASE}/api/projects/${projectId}/checklist/${itemId}`, {
    method: "PATCH",
    headers: {"content-type":"application/json"},
    body: JSON.stringify(patch),
  }));
}

export async function uploadEvidence(projectId: string, itemId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return j<any>(await fetch(`${API_BASE}/api/projects/${projectId}/evidence/${itemId}`, {
    method: "POST",
    body: form,
  }));
}

export function reportUrl(projectId: string, format: "html"|"csv"|"json"|"pdf"="html") {
  return `${API_BASE}/api/reports/${projectId}?format=${format}`;
}
