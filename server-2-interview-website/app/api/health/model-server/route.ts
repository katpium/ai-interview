import { NextResponse } from "next/server";
import { checkModelServerHealth } from "@/lib/modelApi";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await checkModelServerHealth();
    return NextResponse.json(
      {
        ok: result.ok,
        upstream_status: result.status,
        upstream_body: result.body,
      },
      { status: result.ok ? 200 : 502 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
