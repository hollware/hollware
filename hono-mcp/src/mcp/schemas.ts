import * as z from 'zod'

// The Zod side of the three operations.

/** A factory so a benchmark can measure building the schemas per request; the Worker never does. */
export function createSchemas() {
  return {
    echoInput: z.object({
      message: z.string().min(1).max(200).describe('Text to echo back'),
    }),
    echoOutput: z.object({
      echoed: z.string(),
      length: z.number().int(),
    }),
    createNoteInput: z.object({
      title: z.string().min(1).max(120).describe('Note title'),
      body: z.string().max(10_000).describe('Markdown body'),
      tags: z.array(z.string().min(1).max(40)).max(20).default([]).describe('Tags, at most 20'),
    }),
    createNoteOutput: z.object({
      outcome: z.literal('created'),
      note: z.object({
        id: z.string(),
        title: z.string(),
        version: z.number().int(),
        tags: z.array(z.string()),
      }),
    }),
    alwaysFailsInput: z.object({
      mode: z.enum(['return', 'throw']).describe('How the tool reports the failure'),
    }),
    alwaysFailsOutput: z.object({ unreachable: z.string() }),
  }
}

export type Schemas = ReturnType<typeof createSchemas>

/** Built once per isolate, at module scope. */
export const SCHEMAS = createSchemas()

export const {
  echoInput,
  echoOutput,
  createNoteInput,
  createNoteOutput,
  alwaysFailsInput,
  alwaysFailsOutput,
} = SCHEMAS
