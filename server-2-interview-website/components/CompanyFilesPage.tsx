"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminNav from "@/components/AdminNav";
import Link from "next/link";

type CompanyFile = { name: string; size: number; ext: string };
type AuthUser    = { username: string; role: string };

const ALLOWED_ROLES = ["admin", "technician"];

const EXT_LABELS: Record<string, string> = {
  ".pdf": "PDF", ".docx": "DOCX", ".doc": "DOC",
  ".txt": "TXT", ".md": "MD",  ".pptx": "PPTX",
  ".xlsx": "XLSX", ".html": "HTML",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── File viewer panel ─────────────────────────────────────────────────

function FileViewer({
  filename,
  content,
  source,
  onClose,
  onDelete,
}: {
  filename: string;
  content: string;
  source: "raw" | "markdown" | "none";
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div className="flex h-full w-full max-w-2xl flex-col bg-neutral-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-100 truncate">{filename}</p>
            <p className="text-xs text-neutral-500 mt-0.5">
              {source === "markdown" ? "Showing converted Markdown" :
               source === "raw"      ? "Raw file content" :
               "Preview unavailable"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            <button
              type="button"
              onClick={onDelete}
              className="rounded-full border border-red-800/50 px-3 py-1.5 text-xs text-red-500 hover:border-red-600 hover:text-red-400"
            >
              Delete file
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-300 font-mono">
            {content}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────

export default function CompanyFilesPage() {
  const [user, setUser]             = useState<AuthUser | null>(null);
  const [companyId, setCompanyId]   = useState("novaforge");
  const [files, setFiles]           = useState<CompanyFile[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [uploadMsg, setUploadMsg]   = useState<string | null>(null);
  const [ingesting, setIngesting]   = useState(false);
  const [ingestMsg, setIngestMsg]   = useState<string | null>(null);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const [pendingDeleteName, setPendingDeleteName] = useState<string | null>(null);

  // Viewer state
  const [viewFile, setViewFile] = useState<{ filename: string; content: string; source: "raw" | "markdown" | "none" } | null>(null);
  const [loadingView, setLoadingView] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canAccess = user ? ALLOWED_ROLES.includes(user.role) : false;

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json())
      .then((d: { user: AuthUser | null }) => setUser(d.user ?? null))
      .catch(() => {});
  }, []);

  const loadFiles = useCallback(async (cid: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/company-files?companyId=${encodeURIComponent(cid)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { files: CompanyFile[] };
      setFiles(d.files ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (user && canAccess) void loadFiles(companyId); }, [user, canAccess, companyId, loadFiles]);

  const upload = async (file: File) => {
    setUploading(true);
    setUploadMsg(null);
    try {
      const form = new FormData();
      form.append("companyId", companyId);
      form.append("file", file);
      const res = await fetch("/api/admin/company-files", { method: "POST", body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUploadMsg(`✓ ${file.name} uploaded`);
      void loadFiles(companyId);
    } catch (e) {
      setUploadMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const viewFileContent = async (name: string) => {
    setLoadingView(name);
    try {
      const res = await fetch(`/api/admin/company-files/${encodeURIComponent(name)}?companyId=${encodeURIComponent(companyId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { content: string; source: "raw" | "markdown" | "none" };
      setViewFile({ filename: name, content: d.content, source: d.source });
    } catch (e) {
      alert(`Could not load file: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingView(null);
    }
  };

  const deleteFile = async (name: string) => {
    setDeleting(name);
    setViewFile(null);
    setPendingDeleteName(null);
    try {
      await fetch(`/api/admin/company-files/${encodeURIComponent(name)}?companyId=${encodeURIComponent(companyId)}`, { method: "DELETE" });
      void loadFiles(companyId);
    } finally {
      setDeleting(null);
    }
  };

  const ingest = async () => {
    setIngesting(true);
    setIngestMsg(null);
    try {
      const res = await fetch("/api/admin/ingest-company-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { converted?: { source: string; method: string }[] };
      setIngestMsg(`✓ Converted ${d.converted?.length ?? 0} file(s) to Markdown`);
    } catch (e) {
      setIngestMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIngesting(false);
    }
  };

  if (user && !canAccess) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100">
        <AdminNav />
        <div className="flex items-center justify-center p-12">
          <div className="text-center space-y-2">
            <p className="text-lg font-semibold">Access Denied</p>
            <p className="text-sm text-neutral-400">Company file management is restricted to admin and technician roles.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <AdminNav />

      {/* File viewer panel */}
      {viewFile && (
        <FileViewer
          filename={viewFile.filename}
          content={viewFile.content}
          source={viewFile.source}
          onClose={() => setViewFile(null)}
          onDelete={() => { setViewFile(null); setPendingDeleteName(viewFile.filename); }}
        />
      )}

      <div className="mx-auto max-w-3xl p-6 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Company Files</h1>
          <p className="text-sm text-neutral-400 mt-0.5">
            Upload company documents used to generate role-specific interview questions.
          </p>
        </header>

        {/* Company selector */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-neutral-400">Company:</label>
          <input type="text" value={companyId}
            onChange={e => setCompanyId(e.target.value)}
            onBlur={() => void loadFiles(companyId)}
            className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 focus:border-indigo-500 focus:outline-none w-40"
          />
        </div>

        {/* Upload */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-neutral-200">Upload File</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md,.pptx,.xlsx,.html"
              onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }}
              className="block text-sm text-neutral-400 file:mr-3 file:rounded-full file:border-0 file:bg-neutral-800 file:px-4 file:py-1.5 file:text-sm file:text-neutral-300 file:cursor-pointer hover:file:bg-neutral-700"
            />
            {uploading && <span className="text-xs text-neutral-400">Uploading…</span>}
          </div>
          {uploadMsg && (
            <p className={`text-xs ${uploadMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>{uploadMsg}</p>
          )}
        </section>

        {/* File list */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
              Files {loading ? <span className="font-normal text-neutral-600">— loading…</span> : `(${files.length})`}
            </h2>
            <div className="flex items-center gap-2">
              {ingestMsg && (
                <span className={`text-xs ${ingestMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>{ingestMsg}</span>
              )}
              {files.length > 0 && (
                <button type="button" disabled={ingesting} onClick={() => void ingest()}
                  className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
                  {ingesting ? "Converting…" : "Convert to Markdown"}
                </button>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {!loading && files.length === 0 && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-8 text-center text-sm text-neutral-500">
              No files yet — upload documents above to enable question generation.
            </div>
          )}

          {files.map(f => (
            <div key={f.name}
              className="flex items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3 transition hover:border-neutral-700">
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex-shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 uppercase">
                  {EXT_LABELS[f.ext] ?? f.ext.slice(1).toUpperCase()}
                </span>
                <span className="text-sm text-neutral-200 truncate">{f.name}</span>
                <span className="text-xs text-neutral-600 flex-shrink-0">{formatBytes(f.size)}</span>
              </div>
              <div className="flex flex-shrink-0 gap-2">
                <button
                  type="button"
                  disabled={loadingView === f.name}
                  onClick={() => void viewFileContent(f.name)}
                  className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:border-indigo-600 hover:text-indigo-300 disabled:opacity-40"
                >
                  {loadingView === f.name ? "Loading…" : "View"}
                </button>
                {pendingDeleteName === f.name ? (
                  <>
                    <span className="text-xs text-red-400">Delete?</span>
                    <button
                      type="button"
                      onClick={() => void deleteFile(f.name)}
                      className="rounded-full border border-red-700 bg-red-900/20 px-2.5 py-1 text-xs text-red-400 hover:bg-red-900/40"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteName(null)}
                      className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:text-white"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={deleting === f.name}
                    onClick={() => setPendingDeleteName(f.name)}
                    className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-500 hover:border-red-700 hover:text-red-400 disabled:opacity-40"
                  >
                    {deleting === f.name ? "…" : "Delete"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>

        {/* How it works */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-xs text-neutral-500 space-y-1">
          <p className="font-medium text-neutral-400">How it works</p>
          <p>1. Upload your company documents (job descriptions, culture docs, tech stack overview, etc.)</p>
          <p>2. Click <strong className="text-neutral-300">Convert to Markdown</strong> — converts PDFs and DOCX to clean text</p>
          <p>3. Click <strong className="text-neutral-300">View</strong> on any file to preview its content (or converted Markdown)</p>
          <p>4. Go to <Link href="/admin/questions" className="underline hover:text-neutral-300">Question Review</Link> → <strong className="text-neutral-300">Generate Questions</strong> to use these files as context</p>
        </section>
      </div>
    </div>
  );
}
