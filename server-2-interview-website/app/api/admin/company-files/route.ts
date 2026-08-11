/**
 * Company file management API.
 * Only admin and technician roles can access this (enforced by middleware via RBAC).
 *
 * GET  /api/admin/company-files?companyId=novaforge  → list files
 * POST /api/admin/company-files                      → upload file (multipart)
 */

import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const COMPANY_FILES_DIR = path.join(process.cwd(), "storage", "company-files");

function safeCompanyId(id: string): string | null {
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(id)) return null;
  return id;
}

function safeName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && !name.startsWith(".");
}

// ─── GET — list files ─────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawId = searchParams.get("companyId") ?? "novaforge";
  const companyId = safeCompanyId(rawId);
  if (!companyId) return NextResponse.json({ error: "Invalid companyId" }, { status: 400 });

  const dir = path.join(COMPANY_FILES_DIR, companyId);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ companyId, files: [] });
    }
    throw err;
  }

  const files = await Promise.all(
    entries
      .filter(e => !e.startsWith("."))
      .map(async name => {
        const stat = await fs.stat(path.join(dir, name)).catch(() => null);
        return stat?.isFile()
          ? { name, size: stat.size, ext: path.extname(name).toLowerCase() }
          : null;
      })
  );

  return NextResponse.json({ companyId, files: files.filter(Boolean) });
}

// ─── POST — upload file ───────────────────────────────────────────────

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const form = await request.formData();
  const rawId    = ((form.get("companyId") as string | null) ?? "novaforge").trim();
  const companyId = safeCompanyId(rawId);
  if (!companyId) return NextResponse.json({ error: "Invalid companyId" }, { status: 400 });

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "`file` field is required" }, { status: 400 });
  }

  const f = file as File;
  if (!safeName(f.name)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const dir = path.join(COMPANY_FILES_DIR, companyId);
  await fs.mkdir(dir, { recursive: true });

  const dest = path.join(dir, f.name);
  const buf = Buffer.from(await f.arrayBuffer());
  await fs.writeFile(dest, buf);

  console.log(`[CompanyFiles] uploaded ${f.name} (${f.size} bytes) to ${companyId}`);
  return NextResponse.json({ ok: true, name: f.name, size: f.size, companyId });
}
