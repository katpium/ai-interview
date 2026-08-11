/**
 * LightRAG service — embedding-powered knowledge retrieval.
 *
 * This module indexes company documents into vector embeddings and retrieves
 * relevant context using cosine similarity. It uses:
 *   - OpenRouter API with openai/text-embedding-3-small for embeddings
 *   - Semantic chunking of company Markdown documents
 *   - Cosine similarity ranking for retrieval
 *
 * Public API (unchanged from the original scaffold):
 *     indexCompanyKnowledge(companyId)
 *     retrieveCompanyContext(companyId, query)
 *
 * When LIGHTRAG_ENABLED=true and OPENROUTER_API_KEY is set, real embedding
 * retrieval runs. Otherwise, the keyword fallback is used.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { readCompanyMarkdown } from "@/lib/companyFiles";
import {
  getEmbedding,
  getEmbeddings,
  cosineSimilarity,
} from "@/lib/openRouterClient";

const COMPANY_KNOWLEDGE_DIR = path.join(
  process.cwd(),
  "storage",
  "company-knowledge"
);

// Flip to "true" once a real LightRAG backend is wired up. Until then the
// fallback always runs so the app never depends on missing LLM credentials.
const LIGHTRAG_ENABLED = process.env.LIGHTRAG_ENABLED === "true";

export type RetrievalMethod = "fallback-keyword" | "lightrag";

export type KnowledgeChunk = {
  id: string;
  source: string; // markdown filename the chunk came from
  text: string;
};

export type EmbeddedChunk = KnowledgeChunk & {
  embedding: number[];
};

export type CompanyIndex = {
  companyId: string;
  builtAt: string; // ISO timestamp
  method: RetrievalMethod;
  chunkCount: number;
  chunks: KnowledgeChunk[];
  embeddedChunks?: EmbeddedChunk[]; // present when method is "lightrag"
};

export type RetrievalResult = {
  companyId: string;
  query: string;
  method: RetrievalMethod;
  context: string; // combined retrieved text, ready to feed a prompt
  chunks: KnowledgeChunk[]; // the chunks that were selected
};

function safeCompanyId(companyId: string): string {
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(companyId)) {
    throw new Error("Invalid company id");
  }
  return companyId;
}

function indexPath(companyId: string): string {
  return path.join(COMPANY_KNOWLEDGE_DIR, companyId, "index.json");
}

/**
 * Semantic chunking: splits Markdown into meaningful sections.
 * Uses heading boundaries (## / ###) and falls back to blank-line blocks.
 * Merges small blocks together so each chunk has enough context for
 * meaningful embedding.
 */
const MIN_CHUNK_LENGTH = 100; // merge tiny blocks
const MAX_CHUNK_LENGTH = 1500; // split oversized blocks

function chunkDocs(
  docs: { filename: string; content: string }[]
): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];

  for (const doc of docs) {
    // Split on Markdown headings (##, ###) to get semantic sections
    const sections = doc.content.split(/(?=^#{1,3}\s)/m).filter((s) => s.trim());

    let buffer = "";
    let blockIdx = 0;

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) continue;

      // If adding this section would exceed max, flush buffer first
      if (buffer && (buffer.length + trimmed.length) > MAX_CHUNK_LENGTH) {
        chunks.push({
          id: `${doc.filename}#${blockIdx}`,
          source: doc.filename,
          text: buffer.trim(),
        });
        blockIdx++;
        buffer = "";
      }

      buffer += (buffer ? "\n\n" : "") + trimmed;

      // Flush if buffer is large enough on its own
      if (buffer.length >= MIN_CHUNK_LENGTH) {
        chunks.push({
          id: `${doc.filename}#${blockIdx}`,
          source: doc.filename,
          text: buffer.trim(),
        });
        blockIdx++;
        buffer = "";
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      chunks.push({
        id: `${doc.filename}#${blockIdx}`,
        source: doc.filename,
        text: buffer.trim(),
      });
    }
  }

  return chunks;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

// Rank chunks by how many query tokens they contain. Returns the top matches
// with a non-zero score (empty array if nothing matched).
function keywordRank(
  chunks: KnowledgeChunk[],
  query: string,
  topN: number
): KnowledgeChunk[] {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return [];
  const scored = chunks
    .map((chunk) => {
      const chunkTokens = tokenize(chunk.text);
      let score = 0;
      for (const t of chunkTokens) if (queryTokens.has(t)) score += 1;
      return { chunk, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
  return scored.map((s) => s.chunk);
}

async function writeIndex(
  companyId: string,
  index: CompanyIndex
): Promise<void> {
  const dir = path.join(COMPANY_KNOWLEDGE_DIR, companyId);
  await fs.mkdir(dir, { recursive: true });
  const file = indexPath(companyId);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(index, null, 2), "utf8");
  await fs.rename(tmp, file);
}

async function readIndex(companyId: string): Promise<CompanyIndex | null> {
  try {
    const raw = await fs.readFile(indexPath(companyId), "utf8");
    return JSON.parse(raw) as CompanyIndex;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Build (or rebuild) the knowledge index for a company from its Markdown.
 * When LIGHTRAG_ENABLED=true, generates real embeddings via OpenRouter.
 * Persists the index under storage/company-knowledge/<companyId>/index.json.
 */
export async function indexCompanyKnowledge(
  companyId: string
): Promise<CompanyIndex> {
  safeCompanyId(companyId);

  const docs = await readCompanyMarkdown(companyId);
  const chunks = chunkDocs(docs);

  if (LIGHTRAG_ENABLED) {
    console.log(
      `[LightRAG] Indexing ${chunks.length} chunks for "${companyId}" with embeddings...`
    );

    // Batch embed all chunks via OpenRouter
    const texts = chunks.map((c) => c.text);
    const batchSize = 20; // avoid hitting rate limits
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const results = await getEmbeddings(batch);
      allEmbeddings.push(...results.map((r) => r.embedding));
    }

    const embeddedChunks: EmbeddedChunk[] = chunks.map((chunk, i) => ({
      ...chunk,
      embedding: allEmbeddings[i],
    }));

    const index: CompanyIndex = {
      companyId,
      builtAt: new Date().toISOString(),
      method: "lightrag",
      chunkCount: chunks.length,
      chunks,
      embeddedChunks,
    };
    await writeIndex(companyId, index);
    console.log(
      `[LightRAG] ✓ Indexed ${chunks.length} chunks with ${allEmbeddings[0]?.length ?? 0}-dim embeddings`
    );
    return index;
  }

  // Fallback: keyword-only index (no embeddings)
  const index: CompanyIndex = {
    companyId,
    builtAt: new Date().toISOString(),
    method: "fallback-keyword",
    chunkCount: chunks.length,
    chunks,
  };
  await writeIndex(companyId, index);
  return index;
}

/**
 * Retrieve company context relevant to a query.
 * When LIGHTRAG_ENABLED=true, uses cosine similarity on embeddings.
 * Builds the index on demand if it does not exist yet.
 *
 * options.maxChunks — cap the number of chunks returned (default: 8 for
 * embedding retrieval, 6 for keyword fallback). Pass a smaller value (e.g. 3)
 * when a concise context is needed (e.g. answering a candidate's question).
 */
export async function retrieveCompanyContext(
  companyId: string,
  query: string,
  options?: { maxChunks?: number }
): Promise<RetrievalResult> {
  safeCompanyId(companyId);

  let index = await readIndex(companyId);
  if (!index) {
    index = await indexCompanyKnowledge(companyId);
  }

  // ── Real embedding retrieval ─────────────────────────────────────
  if (LIGHTRAG_ENABLED && index.embeddedChunks && index.embeddedChunks.length > 0) {
    const TOP_K = options?.maxChunks ?? 8;
    console.log(
      `[LightRAG] Retrieving context for query: "${query.slice(0, 80)}..." (top ${TOP_K})`
    );

    const queryEmbedding = await getEmbedding(query);

    const scored = index.embeddedChunks
      .map((chunk) => ({
        chunk: { id: chunk.id, source: chunk.source, text: chunk.text },
        score: cosineSimilarity(queryEmbedding.embedding, chunk.embedding),
      }))
      .sort((a, b) => b.score - a.score);

    const MIN_SIMILARITY = 0.15;
    const selected = scored
      .filter((s) => s.score >= MIN_SIMILARITY)
      .slice(0, TOP_K);

    const finalChunks =
      selected.length > 0 ? selected.map((s) => s.chunk) : index.chunks.slice(0, TOP_K);

    const context = finalChunks.map((c) => c.text).join("\n\n");

    console.log(
      `[LightRAG] ✓ Retrieved ${finalChunks.length} chunks (top score: ${scored[0]?.score.toFixed(4) ?? "n/a"})`
    );

    return { companyId, query, method: "lightrag", context, chunks: finalChunks };
  }

  // ── Fallback: keyword ranking ────────────────────────────────────
  const topN = options?.maxChunks ?? 6;
  const ranked = keywordRank(index.chunks, query, topN);
  const selected = ranked.length > 0 ? ranked : index.chunks.slice(0, topN);
  const context = selected.map((c) => c.text).join("\n\n");

  return { companyId, query, method: "fallback-keyword", context, chunks: selected };
}
