import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const COMPANY_FILES_DIR    = path.join(process.cwd(), "storage", "company-files");
const COMPANY_MARKDOWN_DIR = path.join(process.cwd(), "storage", "company-markdown");

const NATIVE_TEXT = new Set([".txt", ".md", ".markdown"]);

function safeName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && !name.startsWith(".");
}

/**
 * GET /api/admin/company-files/[filename]?companyId=novaforge
 *
 * Returns the file content as plain text.
 * - .txt / .md  → raw file content
 * - PDF / DOCX  → converted Markdown from storage/company-markdown/ (if ingested)
 * - Otherwise   → "Preview not available" message
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  if (!safeName(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const companyId = (searchParams.get("companyId") ?? "novaforge").replace(/[^a-z0-9-_]/gi, "");
  const ext = path.extname(filename).toLowerCase();

  // Native text — read directly
  if (NATIVE_TEXT.has(ext)) {
    try {
      const content = await fs.readFile(path.join(COMPANY_FILES_DIR, companyId, filename), "utf8");
      return NextResponse.json({ ok: true, filename, source: "raw", content });
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
  }

  // Binary formats — try to return the converted Markdown (from ingest step)
  const mdName = `${path.basename(filename, ext)}.md`;
  const mdPath = path.join(COMPANY_MARKDOWN_DIR, companyId, mdName);
  try {
    const content = await fs.readFile(mdPath, "utf8");
    return NextResponse.json({ ok: true, filename, source: "markdown", content });
  } catch {
    // Markdown not generated yet — tell the user to ingest first
    return NextResponse.json({
      ok: true,
      filename,
      source: "none",
      content: `Preview not available for ${ext.slice(1).toUpperCase()} files.\n\nClick "Convert to Markdown" on the Company Files page first, then view again.`,
    });
  }
}

/** DELETE /api/admin/company-files/[filename]?companyId=novaforge */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  if (!safeName(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const companyId = (searchParams.get("companyId") ?? "novaforge").replace(/[^a-z0-9-_]/gi, "");

  const file = path.join(COMPANY_FILES_DIR, companyId, filename);
  try {
    await fs.unlink(file);
    // Also delete the converted Markdown if it exists
    const ext    = path.extname(filename).toLowerCase();
    const mdName = `${path.basename(filename, ext)}.md`;
    await fs.unlink(path.join(COMPANY_MARKDOWN_DIR, companyId, mdName)).catch(() => {});
    console.log(`[CompanyFiles] deleted ${filename} (+ markdown) from ${companyId}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    throw err;
  }
}
