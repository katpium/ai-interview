/**
 * Extract plain text from a candidate CV file.
 *
 * Supported natively: .txt, .md
 * Supported via MarkItDown (if installed): .pdf, .docx, .doc, .pptx, .xlsx
 * Everything else: returns null (skipped gracefully).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CVS_DIR = path.join(process.cwd(), "storage", "cvs");

const NATIVE_TEXT = new Set([".txt", ".md", ".markdown"]);
const MARKITDOWN_TYPES = new Set([".pdf", ".docx", ".doc", ".pptx", ".xlsx", ".html"]);

async function isMarkitdownAvailable(): Promise<boolean> {
  try {
    await execFileAsync("markitdown", ["--help"]);
    return true;
  } catch {
    return false;
  }
}

export async function extractCvText(filename: string): Promise<string | null> {
  const filePath = path.join(CVS_DIR, filename);
  const ext = path.extname(filename).toLowerCase();

  if (NATIVE_TEXT.has(ext)) {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch {
      return null;
    }
  }

  if (MARKITDOWN_TYPES.has(ext)) {
    const available = await isMarkitdownAvailable();
    if (!available) {
      console.warn(`[CV] MarkItDown not installed — cannot extract text from ${filename}`);
      return null;
    }
    try {
      const { stdout } = await execFileAsync("markitdown", [filePath]);
      return stdout.trim() || null;
    } catch (err) {
      console.warn(`[CV] MarkItDown failed for ${filename}:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  console.warn(`[CV] Unsupported file type: ${ext}`);
  return null;
}

export async function saveCv(file: File, token: string): Promise<string> {
  await fs.mkdir(CVS_DIR, { recursive: true });
  const ext = path.extname(file.name).toLowerCase() || ".pdf";
  const filename = `${token}${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(CVS_DIR, filename), buf);
  return filename;
}

export async function deleteCv(filename: string): Promise<void> {
  try {
    await fs.unlink(path.join(CVS_DIR, filename));
  } catch {
    // ignore if already gone
  }
}
