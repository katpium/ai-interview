import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { createInvite, updateInvite } from "@/lib/invites";
import { saveCv } from "@/lib/cvExtract";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const jar = await cookies();
  const authToken = jar.get(COOKIE_NAME)?.value;
  const payload = authToken ? await verifyToken(authToken) : null;
  const createdBy = payload?.username ?? "unknown";

  const contentType = req.headers.get("content-type") ?? "";

  let candidateNote = "";
  let interviewRole = "Software Engineer";
  let interviewLevel = "Mid-level";
  let expiryHours = 72;
  let cvFile: File | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    candidateNote  = ((form.get("candidateNote")  as string | null) ?? "").trim();
    interviewRole  = ((form.get("interviewRole")   as string | null) ?? "Software Engineer").trim();
    interviewLevel = ((form.get("interviewLevel")  as string | null) ?? "Mid-level").trim();
    expiryHours    = Number(form.get("expiryHours") ?? 72);
    const uploaded = form.get("cv");
    if (uploaded instanceof File && uploaded.size > 0) cvFile = uploaded;
  } else {
    try {
      const body = (await req.json()) as { candidateNote?: string; interviewRole?: string; interviewLevel?: string; expiryHours?: number };
      candidateNote  = (body.candidateNote  ?? "").trim();
      interviewRole  = (body.interviewRole  ?? "Software Engineer").trim();
      interviewLevel = (body.interviewLevel ?? "Mid-level").trim();
      expiryHours    = body.expiryHours ?? 72;
    } catch { /* defaults */ }
  }

  // 1 — Create the invite (generates the UUID token).
  const invite = await createInvite({
    companyId: "novaforge",
    interviewRole: interviewRole || "Software Engineer",
    interviewLevel: interviewLevel || "Mid-level",
    candidateNote,
    expiryHours: Number.isFinite(expiryHours) ? expiryHours : 72,
    createdBy,
    cvFilename: null,
  });

  // 2 — Save CV using the invite token as the filename so they're linked.
  if (cvFile) {
    try {
      const cvFilename = await saveCv(cvFile, invite.token);
      await updateInvite(invite.token, { cvFilename });
      invite.cvFilename = cvFilename;
      console.log(`[Invites] saved CV: ${cvFilename} (${cvFile.size} bytes)`);
    } catch (err) {
      console.warn("[Invites] CV save failed:", err instanceof Error ? err.message : err);
    }
  }

  console.log(
    `[Invites] created token=${invite.token.slice(0, 8)}… by=${createdBy} ` +
      `note="${invite.candidateNote}" role="${invite.interviewRole}" cv=${invite.cvFilename ?? "none"}`
  );
  return NextResponse.json({ ok: true, invite });
}
