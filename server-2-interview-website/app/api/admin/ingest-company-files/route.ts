import { NextResponse } from "next/server";
import { ingestCompanyFiles } from "@/lib/companyFiles";

export const dynamic = "force-dynamic";

const DEFAULT_COMPANY_ID = "demo-company";

/**
 * Convert a company's source files to Markdown.
 * Body (optional): { "companyId": "demo-company" }. Defaults to demo-company.
 */
export async function POST(request: Request) {
  let companyId = DEFAULT_COMPANY_ID;
  try {
    const body = await request.json();
    if (body && typeof body.companyId === "string" && body.companyId.trim()) {
      companyId = body.companyId.trim();
    }
  } catch {
    // No body or not JSON — fall back to the default company.
  }

  try {
    const result = await ingestCompanyFiles(companyId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to ingest company files",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
