import { z } from "zod";

// Mirrors ExtractionResult.payload in docs/data_model.md and the pydantic
// schema in workers/estimator_workers/extraction.py. The worker already
// validates before writing this JSONB payload, but the column itself has
// no schema enforcement at the DB level -- re-validating here before
// promotion is the "Next.js validates the ExtractionResult payload" step
// from docs/mvp/implementation_plan.md -> Phase 4.
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
