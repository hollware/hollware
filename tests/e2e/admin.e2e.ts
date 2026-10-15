import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, post, setUp, target, writeMarkdown } from './support.ts'

// Fails when: the admin (packages/admin) stops letting people publish the way v0.3 says, in a
// browser with a passkey. AC-0.3-3: the owner sets up a passkey from the link of `hollware init`,
// writes a post and its translation in the editor, saves them and publishes. AC-0.3-2: the owner
// invites an author, who sets up a passkey from the invitation, edits the post and publishes it,
// which asks for a review; the owner reads the review and approves it, which publishes it.
// AC-0.3-4: axe finds nothing serious or critical on any page of the admin or of the sign-in.

test.describe.configure({ mode: 'serial' })

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
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible()
  await writeMarkdown(page, post(title, 'hello-world'))
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
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
  await owner.getByRole('button', { name: 'Publish' }).click()

  await expect(owner.getByText('Published', { exact: true })).toBeVisible()
  await owner.goto('/admin/')
  await expect(owner.getByRole('row', { name: /Hola mundo/ })).toContainText('published')
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
  await expect(author.getByText('Saved', { exact: true })).toBeVisible()
  await author.getByRole('button', { name: 'Publish' }).click()
  await expect(author.getByText('Sent for review')).toBeVisible()

  await owner.goto('/admin/reviews')
  await expect(owner.getByRole('heading', { name: 'Reviews', level: 1 })).toBeVisible()
  await owner.getByRole('button', { name: /Hola mundo, otra vez.*asked by Ana/ }).click()
  await expect(owner.getByText('Hola mundo, otra vez').first()).toBeVisible()
  await expectAccessible(owner)
  await owner.getByRole('button', { name: 'Approve and publish' }).click()

  await expect(owner.getByText('Approved and published')).toBeVisible()
  await expect(owner.getByText('Nothing waits for review.')).toBeVisible()
})

test('AC-0.3-4: the other pages of the admin and the sign-in page', async () => {
  for (const [path, heading] of [
    ['/admin/tokens', 'Personal tokens'],
    ['/signin', 'Sign in'],
  ] as const) {
    await owner.goto(path)
    await expect(owner.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    await expectAccessible(owner)
  }
})
