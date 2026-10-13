import type { DescribedSchema, ResolvedCollection } from '../config/types.ts'
import { fixForIssue, type FixSubject, issueSegments } from './schema-fix.ts'
import { type JsonObject, pointer } from './text.ts'
import type { ContractFinding } from './types.ts'

/**
 * The frontmatter schema and the props schemas of a collection as JSON Schema (draft 2020-12,
 * what a Standard Schema says it accepts). Converting costs, and the answer only changes when the
 * config does, so it is made once per resolved collection. A schema that does not convert is
 * `null`: its fixes fall back to the library's messages and the hash records that it was not
 * there. The config module is where such a schema is refused.
 */
export interface SchemaSnapshot {
  readonly frontmatter: JsonObject | null
  readonly components: ReadonlyMap<string, JsonObject | null>
}

const SNAPSHOTS = new WeakMap<ResolvedCollection, SchemaSnapshot>()

function toJsonSchema(schema: DescribedSchema): JsonObject | null {
  try {
    return schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
  } catch {
    return null
  }
}

export function schemaSnapshot(collection: ResolvedCollection): SchemaSnapshot {
  let snapshot = SNAPSHOTS.get(collection)
  if (snapshot === undefined) {
    snapshot = {
      frontmatter: toJsonSchema(collection.schema),
      components: new Map(
        [...collection.components].map(([name, component]) => [
          name,
          toJsonSchema(component.props),
        ]),
      ),
    }
    SNAPSHOTS.set(collection, snapshot)
  }
  return snapshot
}

const FRONTMATTER: FixSubject = { container: 'the frontmatter', noun: 'field' }

export type FrontmatterCheck =
  | { readonly passed: true; readonly value: unknown }
  | { readonly passed: false; readonly findings: readonly ContractFinding[] }

/**
 * Validates the frontmatter with the collection's schema. When it passes, `value` is what the
 * schema returned, which is what the collection's own contracts get. Each issue becomes a finding
 * at its JSON Pointer under `/frontmatter`. It throws when the schema does.
 */
export async function checkFrontmatter(
  collection: ResolvedCollection,
  frontmatter: JsonObject,
): Promise<FrontmatterCheck> {
  const result = await collection.schema['~standard'].validate(frontmatter)
  if (!result.issues) return { passed: true, value: result.value }
  const json = schemaSnapshot(collection).frontmatter
  return {
    passed: false,
    findings: result.issues.map((issue) => {
      const segments = issueSegments(issue)
      return {
        path: `/frontmatter${pointer(segments)}`,
        message: issue.message,
        fix: fixForIssue({
          subject: FRONTMATTER,
          schema: json,
          input: frontmatter,
          segments,
          message: issue.message,
        }),
      }
    }),
  }
}
