import Anthropic from "@anthropic-ai/sdk";
import type { Extractor, ExtractInput, ExtractionResult } from "./types";
import { ExtractionResult as ExtractionResultSchema } from "./types";
import { buildPrompt } from "./prompts";

// Vision-LLM extractor (the "magic", layer [3]). Used when ANTHROPIC_API_KEY is
// set. Prompts Claude per doc type with a strict JSON schema + per-field
// confidence, then validates the response against the zod schema.
export class ClaudeExtractor implements Extractor {
  readonly name = "claude";
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = process.env.EXTRACTOR_MODEL || "claude-opus-4-8") {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async extract(input: ExtractInput): Promise<ExtractionResult> {
    const prompt = buildPrompt(input.docTypeHint, input.fewShot);
    const { base64, mediaType } = await resolveImage(input);

    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as any, data: base64 } },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const json = extractJson(text);
    // Validate the envelope; rows are validated per-doc-type by the caller.
    return ExtractionResultSchema.parse(json);
  }
}

function extractJson(text: string): unknown {
  // Tolerate code fences or stray prose around the JSON object.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model output");
  return JSON.parse(candidate.slice(start, end + 1));
}

async function resolveImage(input: ExtractInput): Promise<{ base64: string; mediaType: string }> {
  if (input.imageBase64) {
    return { base64: input.imageBase64, mediaType: input.mediaType || "image/jpeg" };
  }
  if (input.imageUrl.startsWith("data:")) {
    const m = input.imageUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (m) return { mediaType: m[1], base64: m[2] };
  }
  // Remote URL — fetch and inline (keeps the adapter storage-agnostic).
  const res = await fetch(input.imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mediaType = res.headers.get("content-type") || input.mediaType || "image/jpeg";
  return { base64: buf.toString("base64"), mediaType };
}
