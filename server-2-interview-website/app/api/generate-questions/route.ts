import { NextResponse } from "next/server";
import { ingestCompanyFiles } from "@/lib/companyFiles";
import { indexCompanyKnowledge, retrieveCompanyContext } from "@/lib/lightRagService";
import {
  generateQuestionBank,
  readQuestionBank,
  normalizeBank,
  replaceSectionDraftsInBank,
  saveQuestionBank,
  ALL_GENERATABLE_TYPES,
  type GeneratableQuestionType,
} from "@/lib/questionGenerator";

export const dynamic = "force-dynamic";

const DEFAULT_COMPANY_ID = "novaforge";

// Retrieve culture and domain context — deliberately avoids product-specific keywords
// so the retriever pulls company values and tech domain rather than project details.
const RETRIEVAL_QUERY =
  "company culture values engineering team practices technology domain";

/**
 * Generate a question bank (~21 questions) for a company using RAG:
 *   1. Ingest & convert source files to Markdown
 *   2. Index & embed company docs (LightRAG)
 *   3. Retrieve relevant context via cosine similarity
 *   4. Generate categorized question bank via LLM
 *   5. Save to storage/generated-questions/<companyId>-question-bank.json
 *
 * Body (optional): { "companyId": "novaforge" }.
 *
 * Test:
 *   curl -X POST http://localhost:3000/api/generate-questions \
 *     -H "Content-Type: application/json" \
 *     -d '{"companyId": "novaforge"}'
 */
export async function POST(request: Request) {
  let companyId = DEFAULT_COMPANY_ID;
  let role: string | null = null;
  let level: string | null = null;
  let questionTypes: GeneratableQuestionType[] = ALL_GENERATABLE_TYPES;
  try {
    const body = await request.json();
    if (body && typeof body.companyId === "string" && body.companyId.trim()) companyId = body.companyId.trim();
    if (body && typeof body.role  === "string" && body.role.trim())  role  = body.role.trim();
    if (body && typeof body.level === "string" && body.level.trim()) level = body.level.trim();
    if (Array.isArray(body?.questionTypes) && body.questionTypes.length > 0) {
      const valid = body.questionTypes.filter((t: unknown) =>
        typeof t === "string" && (ALL_GENERATABLE_TYPES as string[]).includes(t)
      ) as GeneratableQuestionType[];
      if (valid.length > 0) questionTypes = valid;
    }
  } catch {
    // No body / not JSON — use defaults.
  }

  try {
    const startTime = Date.now();

    console.log(`[GenerateQ] Step 1: Ingesting company files for "${companyId}"...`);
    const ingest = await ingestCompanyFiles(companyId);
    const ingestMs = Date.now() - startTime;
    console.log(
      `[GenerateQ] ✓ Ingested ${ingest.converted.length} files (markitdown: ${ingest.markitdownAvailable}) [${ingestMs}ms]`
    );

    console.log(`[GenerateQ] Step 2: Re-indexing company knowledge (picks up new/changed files)...`);
    const indexStart = Date.now();
    await indexCompanyKnowledge(companyId);
    const indexMs = Date.now() - indexStart;
    console.log(`[GenerateQ] ✓ Knowledge index rebuilt [${indexMs}ms]`);

    console.log(`[GenerateQ] Step 3: Retrieving context...`);
    const retrievalStart = Date.now();
    const retrieval = await retrieveCompanyContext(companyId, RETRIEVAL_QUERY);
    const retrievalMs = Date.now() - retrievalStart;
    console.log(
      `[GenerateQ] ✓ Retrieved ${retrieval.chunks.length} chunks via ${retrieval.method} [${retrievalMs}ms]`
    );

    console.log(`[GenerateQ] Step 4: Generating question bank with LLM (role="${role ?? "none"}" sections=[${questionTypes.join(",")}])...`);
    const llmStart = Date.now();
    const freshBank = await generateQuestionBank(retrieval.context, companyId, role, level, questionTypes);
    const llmMs = Date.now() - llmStart;

    // Replace old draft questions for the regenerated sections; preserve approved questions.
    const existing = await readQuestionBank(companyId, role, level);
    const bank = existing
      ? replaceSectionDraftsInBank(normalizeBank(existing), freshBank.questionBank, questionTypes)
      : freshBank;
    console.log(
      `[GenerateQ] ✓ Bank saved: ${bank.questionBank.length} total questions (source: ${bank.source}) [${llmMs}ms]`
    );

    const savedPath = await saveQuestionBank(bank);
    const totalMs = Date.now() - startTime;
    console.log(`[GenerateQ] ✓ Done! Total: ${totalMs}ms`);

    return NextResponse.json({
      ok: true,
      savedPath,
      retrievalMethod: retrieval.method,
      markitdownAvailable: ingest.markitdownAvailable,
      chunksRetrieved: retrieval.chunks.length,
      timing: { ingestMs, retrievalMs, llmMs, totalMs },
      ...bank,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[GenerateQ] Error:", msg);

    if (msg.startsWith("No role context found")) {
      return NextResponse.json({ ok: false, error: msg, detail: msg }, { status: 422 });
    }

    if (msg === "OPENROUTER_FAILED" || msg === "LLM_DISABLED") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Question generation failed because the AI provider request was blocked or unavailable. Please check OpenRouter settings and try again.",
          detail: msg,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { ok: false, error: "Failed to generate question bank", detail: msg },
      { status: 400 }
    );
  }
}
