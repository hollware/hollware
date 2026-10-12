import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/server'

// Three synthetic operations: a read (echo), a write with structured output (create_note) and one
// that always fails with a tool error (always_fails). This file has no runtime imports, so the
// precomputed-schema variant of the server does not need Zod to run them.

export type EchoInput = { message: string }
export type EchoOutput = { echoed: string; length: number }

/** `tags` is optional on purpose: JSON Schema validation does not apply the Zod default. */
export type CreateNoteInput = { title: string; body: string; tags?: string[] | undefined }
export type CreateNoteOutput = {
  outcome: 'created'
  note: { id: string; title: string; version: number; tags: string[] }
}

export type AlwaysFailsInput = { mode: 'return' | 'throw' }

export const ECHO_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

export const CREATE_NOTE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}

export const ALWAYS_FAILS_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

export function echo(input: EchoInput): CallToolResult {
  const output: EchoOutput = { echoed: input.message, length: input.message.length }
  return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output }
}

export function createNote(input: CreateNoteInput): CallToolResult {
  const slug = input.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const output: CreateNoteOutput = {
    outcome: 'created',
    note: { id: `note-${slug}`, title: input.title, version: 1, tags: input.tags ?? [] },
  }
  return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output }
}

export function alwaysFails(input: AlwaysFailsInput): CallToolResult {
  if (input.mode === 'throw') throw new Error('Draft is locked by another writer (thrown)')
  return {
    isError: true,
    content: [{ type: 'text', text: 'Draft is locked by another writer (returned)' }],
  }
}
