/**
 * OpenRouter API client.
 *
 * Provides two capabilities via OpenRouter (https://openrouter.ai/):
 *   1. Embeddings  — openai/text-embedding-3-small
 *   2. Chat/LLM    — deepseek/deepseek-v4-flash
 *
 * All calls go through the OpenRouter unified API, which proxies to the
 * underlying model providers.
 */

// ─── Config ──────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to .env.local."
    );
  }
  return key;
}

function getBaseUrl(): string {
  return (
    process.env.OPENROUTER_BASE_URL?.replace(/\/+$/, "") ||
    "https://openrouter.ai/api/v1"
  );
}

function getLlmModel(): string {
  return process.env.LLM_MODEL || "deepseek/deepseek-v4-flash";
}

function getEmbeddingModel(): string {
  return process.env.EMBEDDING_MODEL || "openai/text-embedding-3-small";
}

// ─── Types ───────────────────────────────────────────────────────────

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionResult = {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type EmbeddingResult = {
  embedding: number[];
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
};

// ─── Embeddings ──────────────────────────────────────────────────────

/**
 * Get an embedding vector for a single text string.
 */
export async function getEmbedding(text: string): Promise<EmbeddingResult> {
  const res = await fetch(`${getBaseUrl()}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://novaforge-interview.example",
      "X-Title": "NovaForge Interview System",
    },
    body: JSON.stringify({
      model: getEmbeddingModel(),
      input: text,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter embeddings failed: ${res.status} ${res.statusText} ${errText}`
    );
  }

  const data = await res.json();
  return {
    embedding: data.data[0].embedding,
    model: data.model || getEmbeddingModel(),
    usage: data.usage,
  };
}

/**
 * Get embeddings for multiple texts in a single request (batch).
 */
export async function getEmbeddings(
  texts: string[]
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];

  const res = await fetch(`${getBaseUrl()}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://novaforge-interview.example",
      "X-Title": "NovaForge Interview System",
    },
    body: JSON.stringify({
      model: getEmbeddingModel(),
      input: texts,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter embeddings (batch) failed: ${res.status} ${res.statusText} ${errText}`
    );
  }

  const data = await res.json();

  // OpenRouter returns data sorted by index
  const sorted = [...data.data].sort(
    (a: { index: number }, b: { index: number }) => a.index - b.index
  );

  return sorted.map((item: { embedding: number[] }) => ({
    embedding: item.embedding,
    model: data.model || getEmbeddingModel(),
    usage: data.usage,
  }));
}

// ─── Chat / LLM ─────────────────────────────────────────────────────

/**
 * Send a chat completion request to the LLM (deepseek/deepseek-v4-flash).
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  }
): Promise<ChatCompletionResult> {
  const res = await fetch(`${getBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://novaforge-interview.example",
      "X-Title": "NovaForge Interview System",
    },
    body: JSON.stringify({
      model: getLlmModel(),
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2048,
      top_p: options?.topP ?? 0.9,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter chat/completions failed: ${res.status} ${res.statusText} ${errText}`
    );
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  if (!choice) {
    throw new Error("OpenRouter returned no choices");
  }

  return {
    content: choice.message?.content ?? "",
    model: data.model || getLlmModel(),
    usage: data.usage,
  };
}

// ─── Utilities ───────────────────────────────────────────────────────

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: ${a.length} vs ${b.length}`
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
