import { registerBuiltIn } from './registry.ts'
import { runtimeOf } from './runtime.ts'
import { fixForIssue, type FixSubject, issueSegments, label } from './schema-fix.ts'
import { schemaSnapshot } from './schema.ts'
import { quote } from './text.ts'
import type { Contract, ContractFinding } from './types.ts'

export const COMPONENTS: Contract<unknown> = registerBuiltIn(
  {
    id: 'components',
    severity: 'error',
    description: 'The props of every component in the body match the schema of that component.',
    async check(context) {
      const { collection } = runtimeOf('components', context)
      const schemas = schemaSnapshot(collection).components
      const findings: ContractFinding[] = []
      for (const use of context.markdown.extracted.components) {
        const definition = collection.components.get(use.name)
        if (definition === undefined) continue
        const result = await definition.props['~standard'].validate(use.props)
        if (!result.issues) continue
        const subject: FixSubject = { container: `the component ${quote(use.name)}`, noun: 'prop' }
        for (const issue of result.issues) {
          const segments = issueSegments(issue)
          const which = segments.length === 0 ? 'The props' : `The prop ${quote(label(segments))}`
          findings.push({
            path: '/body',
            message: `${which} of the component ${quote(use.name)} ${segments.length === 0 ? 'are' : 'is'} invalid: ${issue.message}`,
            fix: fixForIssue({
              subject,
              schema: schemas.get(use.name) ?? null,
              input: use.props,
              segments,
              message: issue.message,
            }),
            line: use.line,
          })
        }
      }
      return findings
    },
  },
  { readsFrontmatter: false },
)
