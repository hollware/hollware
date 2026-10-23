import type { DescribedSchema, ResolvedCollection } from '../config/types.ts'
import { fixForIssue, type FixSubject, issueSegments } from './schema-fix.ts'
import { type JsonObject, pointer } from './text.ts'
import type { ContractFinding } from './types.ts'

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
