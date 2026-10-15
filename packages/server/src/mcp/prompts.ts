import * as z from 'zod'

/**
 * The prompts of the MCP endpoint: workflows that an agent's user picks by name, written once
 * here. A prompt only says what to do; every step is a tool, checked as any call is.
 */

export const REFRESH_CONTENT = {
  name: 'refresh_content',
  title: 'Refresh what readers read',
  description:
    'Pick a much-read entry whose content has aged, find what the site already says on its subject, and update it through the contracts, ready to publish.',
  args: z.object({
    days: z
      .string()
      .regex(/^[1-9][0-9]?$/)
      .optional()
      .describe('How many days of reading to look at, 1 to 90; 30 when not given.'),
  }),
}

/** The text of `refresh_content`: the steps, each with the tool that takes it. */
export function refreshContentText(days: number): string {
  return [
    `Refresh the content that readers read most, from the last ${days} days.`,
    '',
    `1. Call content_stats with days: ${days}. Pick an entry from the pages with the most views: prefer one whose updatedAt is oldest, or whose subject has moved on. Skip pages with no entry.`,
    '2. Read it with get_entry, with related: true, and read describe_site for its collection: its schema, contracts and style guide.',
    '3. Call search with the subject of the entry in your own words (mode hybrid) to find what the site already says, so that the update links to it instead of repeating it.',
    '4. Write the update: correct what is out of date, add what is missing, link the related entries where they help. Keep the voice of the style guide.',
    '5. Save it with update_draft at the version you read. Fix every error of the verdict, and the warnings you can, saving again; validate checks a version without saving it.',
    '6. Call publish. Without content:publish it asks for a review: say so, with the link it answers. With warnings left, say which and why before you acknowledge them.',
    '',
    'Report the entry you picked and why, what you changed, and how the publish ended.',
  ].join('\n')
}
