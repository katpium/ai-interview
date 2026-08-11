/**
 * Company file → Markdown conversion.
 *
 * Source files live at  storage/company-files/<companyId>/
 * Converted Markdown at  storage/company-markdown/<companyId>/
 *
 * Plain-text formats (.txt/.md) are converted natively (no dependencies).
 * Binary formats (PDF/DOCX/PPTX/XLSX/HTML/...) are converted with the
 * MarkItDown CLI when it is installed. If MarkItDown is not present, those
 * files are skipped with a reason instead of crashing the pipeline.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const COMPANY_FILES_DIR = path.join(process.cwd(), "storage", "company-files");
const COMPANY_MARKDOWN_DIR = path.join(
  process.cwd(),
  "storage",
  "company-markdown"
);

// Formats we can turn into Markdown with no external tooling.
const NATIVE_TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown"]);

export type ConvertedFile = {
  source: string; // original filename
  markdown: string | null; // output filename, or null if skipped
  method: "native" | "markitdown" | "skipped";
  reason?: string; // explanation when skipped
};

export type IngestResult = {
  companyId: string;
  sourceDir: string;
  outputDir: string;
  markitdownAvailable: boolean;
  converted: ConvertedFile[];
};

export type CompanyMarkdownDoc = {
  filename: string;
  content: string;
};

function safeCompanyId(companyId: string): string {
  // Folder name only — block path traversal and odd characters.
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(companyId)) {
    throw new Error("Invalid company id");
  }
  return companyId;
}

let markitdownAvailable: boolean | null = null;
async function isMarkitdownAvailable(): Promise<boolean> {
  if (markitdownAvailable !== null) return markitdownAvailable;
  try {
    await execFileAsync("markitdown", ["--help"]);
    markitdownAvailable = true;
  } catch {
    // TODO: Install MarkItDown (`pip install markitdown`) so PDF/DOCX/PPTX/
    // XLSX/HTML company files can be converted. Until then they are skipped.
    markitdownAvailable = false;
  }
  return markitdownAvailable;
}

/**
 * Convert every file in a company's source folder to Markdown.
 * Returns a per-file report. Skipped files do not fail the whole run.
 */
export async function ingestCompanyFiles(
  companyId: string
): Promise<IngestResult> {
  safeCompanyId(companyId);
  const sourceDir = path.join(COMPANY_FILES_DIR, companyId);
  const outputDir = path.join(COMPANY_MARKDOWN_DIR, companyId);
  await fs.mkdir(outputDir, { recursive: true });

  let entries: string[];
  try {
    entries = await fs.readdir(sourceDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Company source folder not found: ${sourceDir}`);
    }
    throw err;
  }

  const mdAvailable = await isMarkitdownAvailable();
  const converted: ConvertedFile[] = [];

  for (const name of entries.sort()) {
    if (name.startsWith(".")) continue; // skip .gitkeep / hidden files
    const srcPath = path.join(sourceDir, name);
    const stat = await fs.stat(srcPath);
    if (!stat.isFile()) continue;

    const ext = path.extname(name).toLowerCase();
    const outName = `${path.basename(name, path.extname(name))}.md`;
    const outPath = path.join(outputDir, outName);

    if (NATIVE_TEXT_EXTENSIONS.has(ext)) {
      // Plain text / Markdown is already valid Markdown — copy it through.
      const content = await fs.readFile(srcPath, "utf8");
      await fs.writeFile(outPath, content, "utf8");
      converted.push({ source: name, markdown: outName, method: "native" });
      continue;
    }

    if (mdAvailable) {
      try {
        await execFileAsync("markitdown", [srcPath, "-o", outPath]);
        converted.push({
          source: name,
          markdown: outName,
          method: "markitdown",
        });
      } catch (err) {
        converted.push({
          source: name,
          markdown: null,
          method: "skipped",
          reason: `MarkItDown failed: ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        });
      }
    } else {
      converted.push({
        source: name,
        markdown: null,
        method: "skipped",
        reason:
          "MarkItDown CLI not installed — only .txt/.md are converted natively",
      });
    }
  }

  return {
    companyId,
    sourceDir,
    outputDir,
    markitdownAvailable: mdAvailable,
    converted,
  };
}

/**
 * Read all converted Markdown documents for a company.
 * Returns [] if the company has no Markdown yet (caller can trigger ingest).
 */
export async function readCompanyMarkdown(
  companyId: string
): Promise<CompanyMarkdownDoc[]> {
  safeCompanyId(companyId);
  const dir = path.join(COMPANY_MARKDOWN_DIR, companyId);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const docs: CompanyMarkdownDoc[] = [];
  for (const name of entries.sort()) {
    if (name.startsWith(".")) continue;
    if (!name.toLowerCase().endsWith(".md")) continue;
    const content = await fs.readFile(path.join(dir, name), "utf8");
    docs.push({ filename: name, content });
  }
  return docs;
}
