import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, post, setUp, shot, target, writeMarkdown } from './support.ts'

// Fails when: the admin (packages/admin) stops letting people publish the way v0.3 says, in a
// browser with a passkey. AC-0.3-3: the owner sets up a passkey from the link of `hollware init`,
// writes a post and its translation in the editor, saves them and publishes. AC-0.3-2: the owner
// invites an author, who sets up a passkey from the invitation, edits the post and publishes it,
// which asks for a review; the owner reads the review, comments on it and approves it, which
// publishes it. Before v1.0: the owner unpublishes an entry and schedules it again, from the
// editor, and sees what waits for review on the home page.
// AC-0.8-2: the owner makes a collection with a rule in the admin, an entry the rule refuses is
// blocked, and once fixed it is published, with no deploy between.
// AC-0.3-4: axe finds nothing serious or critical on any page of the admin or of the sign-in.

test.describe.configure({ mode: 'serial' })

// A toast's text is on the page twice for a moment: in the toast, and in the live region that
// announces it. Each check of a toast takes the first.

let owner: Page

async function newEntry(page: Page, locale: 'es' | 'en', title: string, slug: string) {
  await page.goto('/admin/entries/new')
  await expect(page.getByRole('heading', { name: 'New entry' })).toBeVisible()
  await expectAccessible(page)
  if (locale === 'en') {
    await page.getByRole('combobox', { name: 'Locale' }).click()
    await page.getByRole('option', { name: 'en' }).click()
  }
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Slug').fill(slug)
  await page.getByRole('button', { name: 'Create the draft' }).click()
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
  await writeMarkdown(page, post(title, 'hello-world'))
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible()
  await shot(page, `editor-${locale}`)
}

test.beforeAll(async ({ browser }) => {
  owner = await (await browser.newContext({ baseURL: target().url })).newPage()
})

test('AC-0.3-3: the owner writes a post in the editor and publishes it', async () => {
  await setUp(owner, target().setup, 'Olga')
  await expectAccessible(owner)

  await newEntry(owner, 'en', 'Hello world', 'hello-world')
  await newEntry(owner, 'es', 'Hola mundo', 'hola-mundo')
  await expectAccessible(owner)
  await owner.getByRole('button', { name: 'Publish', exact: true }).click()

  await expect(owner.getByText('Published', { exact: true }).first()).toBeVisible()
  await owner.goto('/admin/entries')
  await expect(owner.getByRole('row', { name: /^Hola mundo/ })).toContainText('published')
  await expectAccessible(owner)
  await shot(owner, 'entries')
})

test('AC-0.3-2: an author publishes through review, and the owner approves it', async ({
  browser,
}) => {
  await owner.goto('/admin/people')
  await expect(owner.getByRole('heading', { name: 'Members' })).toBeVisible()
  await expectAccessible(owner)
  await owner.getByRole('button', { name: 'Invite' }).click()
  const link = (await owner.getByText(/\/setup\?invitation=/).textContent()) ?? ''

  const author = await (await browser.newContext({ baseURL: target().url })).newPage()
  await setUp(author, link.trim(), 'Ana')
  await author.goto('/admin/entries/blog/es/hola-mundo')
  await expect(author.getByRole('heading', { name: 'Hola mundo', level: 1 }).first()).toBeVisible()
  await writeMarkdown(author, post('Hola mundo, otra vez', 'hello-world'))
  await author.getByRole('button', { name: 'Save' }).click()
  await expect(author.getByText('Saved', { exact: true }).first()).toBeVisible()
  await author.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(author.getByText('Sent for review').first()).toBeVisible()

  await owner.goto('/admin/reviews')
  await expect(owner.getByRole('heading', { name: 'Reviews', level: 1 })).toBeVisible()
  await owner.getByRole('button', { name: /Hola mundo, otra vez.*asked by Ana/ }).click()
  await expect(owner.getByText('Hola mundo, otra vez').first()).toBeVisible()
  await expect(owner.getByText('No comments yet.')).toBeVisible()
  await owner.getByRole('textbox', { name: 'Comment' }).fill('The title reads well.')
  await owner.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(owner.getByText('The title reads well.')).toBeVisible()
  await shot(owner, 'review')
  await expectAccessible(owner)
  await owner.getByRole('button', { name: 'Approve and publish' }).click()

  await expect(owner.getByText('Approved and published').first()).toBeVisible()
  await expect(owner.getByText('Nothing waits for review.')).toBeVisible()
})

test('the owner unpublishes an entry, then schedules it', async () => {
  await owner.goto('/admin/entries/blog/es/hola-mundo')
  await expect(owner.getByRole('heading', { name: 'Hola mundo, otra vez', level: 1 })).toBeVisible()
  await expect(owner.getByRole('navigation', { name: 'Translations' })).toContainText('en')
  await owner.getByRole('button', { name: 'Unpublish', exact: true }).click()
  await expectAccessible(owner)
  await owner.getByRole('dialog').getByRole('button', { name: 'Unpublish', exact: true }).click()
  await expect(owner.getByText('Unpublished', { exact: true }).first()).toBeVisible()

  await owner.getByRole('button', { name: 'Schedule', exact: true }).click()
  await owner.getByRole('dialog').getByRole('button', { name: 'Schedule', exact: true }).click()
  await expect(owner.getByText('Scheduled', { exact: true }).first()).toBeVisible()
  await expect(owner.getByRole('button', { name: 'Cancel schedule' })).toBeVisible()
  await shot(owner, 'scheduled')

  await owner.goto('/admin/entries?status=scheduled')
  await expect(owner.getByRole('row', { name: /^Hola mundo, otra vez/ })).toContainText('scheduled')
})

test('AC-0.8-2: the owner shapes the site in the admin, and it applies with no deploy', async () => {
  await owner.goto('/admin/collections')
  await expect(owner.getByRole('heading', { name: 'Collections', level: 1 })).toBeVisible()
  await expectAccessible(owner)
  await owner.getByLabel('Name').fill('talks')
  await owner.getByRole('combobox', { name: 'Start from' }).click()
  await owner.getByRole('option', { name: 'Empty: a title alone' }).click()
  await owner.getByRole('button', { name: 'Create the collection' }).click()
  await expect(owner.getByRole('heading', { name: 'talks', level: 1 })).toBeVisible()
  await expectAccessible(owner)

  // A rule: a title of at most 10 characters, or no publishing.
  await owner.getByRole('button', { name: 'Add a rule' }).click()
  await owner.getByRole('combobox', { name: 'field*', exact: true }).click()
  await owner.getByRole('option', { name: 'title', exact: true }).click()
  await owner.getByRole('spinbutton', { name: 'max', exact: true }).fill('10')
  await owner.getByRole('combobox', { name: 'Severity' }).click()
  await owner.getByRole('option', { name: 'error', exact: true }).click()
  await shot(owner, 'collection')
  await owner.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(owner.getByText('Saved: it applies at once').first()).toBeVisible()

  await owner.goto('/admin/entries/new?collection=talks&locale=en')
  await owner.getByLabel('Title').fill('A talk with a long title')
  await owner.getByLabel('Slug').fill('a-long-talk')
  await owner.getByRole('button', { name: 'Create the draft' }).click()
  await owner.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(owner.getByText('Blocked', { exact: true }).first()).toBeVisible()

  await writeMarkdown(owner, '---\ntitle: A talk\n---\n\nShort and plain.\n')
  await owner.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(owner.getByText('Saved', { exact: true }).first()).toBeVisible()
  await owner.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(owner.getByText('Published', { exact: true }).first()).toBeVisible()
})

test('AC-0.3-4: the other pages of the admin and the sign-in page', async () => {
  for (const [path, heading] of [
    ['/admin/', 'Home'],
    ['/admin/site', 'Site'],
    ['/admin/tokens', 'Tokens'],
    ['/signin', 'Sign in'],
  ] as const) {
    await owner.goto(path)
    await expect(owner.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    await expectAccessible(owner)
    await shot(owner, heading.toLowerCase().replaceAll(' ', '-'))
  }
})
