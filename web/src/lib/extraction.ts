import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// Mirrors ExtractionResult.payload in docs/data_model.md: invoice metadata +
// line items, matching Invoice/LineItem fields. Phase 2 is informal --
// this schema exists to validate the LLM's output, not to write anything
// to the database yet.
export const extractionPayloadSchema = z.object({
  supplier_name: z.string(),
  invoice_date: z.string().nullable(),
  total: z.number().nullable(),
  line_items: z.array(
    z.object({
      description: z.string(),
      sku: z.string().nullable(),
      quantity: z.number(),
      unit_price: z.number(),
      total: z.number(),
    }),
  ),
});

export type ExtractionPayload = z.infer<typeof extractionPayloadSchema>;

// KNOWN ISSUE (observed on a real receipt during Phase 2 testing): line item
// descriptions can pick up unrelated text from elsewhere on the document --
// e.g. "BRCKT, CARPORT 13GA SDL HDG 6X6"" absorbed a "THURSDAY DELIVERY"
// note into its description. The prompt needs tightening to constrain
// descriptions to the item's own table cell before this moves into the
// Phase 3 pipeline. See docs/implementation_plan.md -> Phase 2 notes.
const EXTRACTION_PROMPT = `You are extracting structured data from a photo or scan of a construction supplier invoice or receipt.

Return ONLY a JSON object (no markdown fences, no commentary) matching exactly this shape:

{
  "supplier_name": string,
  "invoice_date": string | null,  // ISO 8601 date (YYYY-MM-DD), null if not legible
  "total": number | null,
  "line_items": [
    {
      "description": string,     // exactly as printed on the invoice, do not normalize or interpret abbreviations
      "sku": string | null,
      "quantity": number,
      "unit_price": number,
      "total": number
    }
  ]
}

If a multi-line description wraps across rows in the source table, join it into one description string. If a field is illegible, use null (or omit the line item entirely if it's unreadable). Do not invent data that is not visibly printed on the document.`;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function extractInvoiceData(
  fileBytes: ArrayBuffer,
  mimeType: string,
): Promise<ExtractionPayload> {
  const base64 = Buffer.from(fileBytes).toString("base64");

  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mimeType as "image/jpeg", data: base64 },
          },
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Vision LLM returned no text content.");
  }

  // The prompt asks for raw JSON, but models sometimes wrap it in a
  // markdown code fence anyway -- strip that defensively rather than
  // relying on prompt compliance alone.
  const jsonText = textBlock.text
    .trim()
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(`Vision LLM did not return valid JSON: ${textBlock.text.slice(0, 500)}`);
  }

  const result = extractionPayloadSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Extracted JSON did not match expected schema: ${result.error.message}`);
  }

  return result.data;
}
