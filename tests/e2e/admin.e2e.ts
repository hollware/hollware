import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, post, setUp, shot, target, writeMarkdown } from './support.ts'

// Fails when: the admin (packages/admin) stops letting people publish the way v0.3 says, in a
// browser with a passkey. AC-0.3-3: the owner sets up a passkey from the link of `hollware init`,
// writes a post and its translation in the editor, saves them and publishes. AC-0.3-2: the owner
// invites an author, who sets up a passkey from the invitation, edits the post and publishes it,
// which asks for a review; the owner reads the review, comments on it and approves it, which
// publishes it. Before v1.0: the owner unpublishes an entry and schedules it again, from the
// editor, and sees what waits for review on the home page.
// The owner moves a draft to the trash from the editor, finds it under the trash filter of the
// entries and restores it.
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
  await expect(owner.getByRole('row', { name: /^Select Hola mundo/ })).toContainText('published')
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
  const link = (await owner.getByText(/\/setup#invitation=/).textContent()) ?? ''

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
  await expect(owner.getByRole('row', { name: /^Select Hola mundo, otra vez/ })).toContainText(
    'scheduled',
  )
})

test('AC-0.8-2: the owner shapes the site in the admin, and it applies with no deploy', async () => {
  await owner.goto('/admin/collections')
  await expect(owner.getByRole('heading', { name: 'Collections', level: 1 })).toBeVisible()
  await expectAccessible(owner)
  await owner.getByRole('textbox', { name: 'Name', exact: true }).fill('talks')
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

test('the owner adds a webhook, whose secret Hollware makes and shows once', async () => {
  await owner.goto('/admin/site')
  await expect(owner.getByRole('heading', { name: 'Webhooks' })).toBeVisible()
  await owner.getByRole('textbox', { name: 'Name', exact: true }).last().fill('site')
  await owner.getByLabel('URL', { exact: true }).fill('https://example.com/_hollware/webhook')
  await owner.getByRole('button', { name: 'Add', exact: true }).click()

  await expect(
    owner.getByText('The secret of site: give it to the receiver now, it is shown once'),
  ).toBeVisible()
  await expect(owner.getByText(/^whsec_[0-9a-f]{64}$/)).toBeVisible()
  await expect(owner.getByText("signed by Hollware's secret")).toBeVisible()
  await expectAccessible(owner)
})

test('finds an entry from ⌘K, and filters the table of entries', async () => {
  await owner.goto('/admin/entries')
  await expect(owner.getByRole('row', { name: /^Select Hola mundo/ })).toBeVisible()
  await owner.getByRole('textbox', { name: 'Filter by title, slug or tag' }).fill('hello')
  await expect(owner.getByRole('row', { name: /^Select Hola mundo/ })).toHaveCount(0)
  await expect(owner.getByRole('row', { name: /^Select Hello world/ })).toBeVisible()

  // ⌘K waits while a field has the focus, as it should: the button of the sidebar opens it here.
  await owner.getByRole('button', { name: /^Search/ }).click()
  await owner.getByPlaceholder('Search entries, or go anywhere…').fill('hello')
  await owner
    .getByRole('option', { name: /Hello world/ })
    .first()
    .click()
  await expect(owner.getByRole('heading', { name: 'Hello world', level: 1 })).toBeVisible()
})

test('AC-0.3-4: the other pages of the admin and the sign-in page', async () => {
  for (const [path, heading] of [
    ['/admin/', 'Home'],
    ['/admin/site', 'Site'],
    ['/admin/tokens', 'Tokens'],
    ['/admin/activity', 'Activity'],
    ['/signin', 'Sign in'],
  ] as const) {
    await owner.goto(path)
    await expect(owner.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    // The log loads after the page: axe reads it with its lines in.
    if (heading === 'Activity') {
      await expect(owner.getByRole('row', { name: /Published an entry/ }).first()).toBeVisible()
    }
    await expectAccessible(owner)
    await shot(owner, heading.toLowerCase().replaceAll(' ', '-'))
  }
})

test('the owner reads the activity log: what was done, by whom, and the detail of a line', async () => {
  await owner.goto('/admin/activity')
  await expect(owner.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible()
  const published = owner.getByRole('row', { name: /Published an entry/ }).first()
  await expect(published).toContainText('Olga')
  await expect(published).toContainText('person')
  await expect(published).toContainText('ok')

  await published.getByRole('button', { name: 'Show the detail of publish' }).click()
  await expect(owner.getByRole('dialog').getByText('Declared by the client')).toBeVisible()
  await expectAccessible(owner)
  await owner.keyboard.press('Escape')

  // A filter by action asks the server again: only the lines of that action stay.
  await owner.getByRole('combobox', { name: 'Action' }).click()
  await owner.getByRole('option', { name: 'Approved a review' }).click()
  await expect(owner.getByRole('row', { name: /Approved a review/ }).first()).toBeVisible()
  await expect(owner.getByRole('row', { name: /Published an entry/ })).toHaveCount(0)
  await shot(owner, 'activity-filtered')
})

test('the owner switches the admin to Spanish from the person menu, and it stays Spanish', async () => {
  await owner.goto('/admin/')
  await expect(owner.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible()
  await owner.getByRole('button', { name: /^Olga/ }).click()
  await owner.getByRole('menuitem', { name: 'Language' }).click()
  await owner.getByRole('menuitemcheckbox', { name: 'Español' }).click()

  await expect(owner.getByRole('heading', { name: 'Inicio', level: 1 })).toBeVisible()
  await expect(owner.locator('html')).toHaveAttribute('lang', 'es')
  await expect(owner.getByRole('link', { name: 'Entradas', exact: true })).toBeVisible()
  await expect(owner.getByRole('link', { name: 'Revisiones', exact: true })).toBeVisible()
  await expect(owner.getByRole('heading', { name: 'Lo más leído, últimos 30 días' })).toBeVisible()
  await expectAccessible(owner)

  await owner.reload()
  await expect(owner.getByRole('heading', { name: 'Inicio', level: 1 })).toBeVisible()
  await expect(owner.locator('html')).toHaveAttribute('lang', 'es')
  await owner.goto('/admin/entries')
  await expect(owner.getByRole('heading', { name: 'Entradas', level: 1 })).toBeVisible()
  await expect(
    owner.getByRole('textbox', { name: 'Filtrar por título, slug o etiqueta' }),
  ).toBeVisible()
  await expect(owner.getByRole('row', { name: /^Seleccionar Hola mundo, otra vez/ })).toContainText(
    'programada',
  )
  await expectAccessible(owner)
  await shot(owner, 'entries-es')
})

test('the owner publishes and unpublishes several entries at once, from the table', async () => {
  // The admin is in Spanish since the test before: the bulk actions speak it too.
  await owner.goto('/admin/entries')
  await owner.getByRole('checkbox', { name: 'Seleccionar Hello world' }).click()
  await owner.getByRole('checkbox', { name: 'Seleccionar Hola mundo, otra vez' }).click()
  const bar = owner.getByRole('toolbar', { name: 'Acciones sobre las filas seleccionadas' })
  await expect(bar).toContainText('2 seleccionadas')
  await expectAccessible(owner)

  await bar.getByRole('button', { name: 'Publicar 2' }).click()
  await expect(owner.getByText('2 publicadas', { exact: true }).first()).toBeVisible()
  await expect(owner.getByRole('row', { name: /^Seleccionar Hello world/ })).toContainText(
    'publicada',
  )
  await expect(owner.getByRole('row', { name: /^Seleccionar Hola mundo/ })).toContainText(
    'publicada',
  )
  await shot(owner, 'bulk-es')

  // The selection stays on the rows, now published: unpublishing asks first.
  await bar.getByRole('button', { name: 'Despublicar 2' }).click()
  await expectAccessible(owner)
  await owner.getByRole('dialog').getByRole('button', { name: 'Despublicar 2' }).click()
  await expect(owner.getByText('2 despublicadas', { exact: true }).first()).toBeVisible()
  await expect(owner.getByRole('row', { name: /^Seleccionar Hello world/ })).toContainText(
    'borrador',
  )
  await expect(owner.getByRole('row', { name: /^Seleccionar Hola mundo/ })).toContainText(
    'borrador',
  )
})

test('a page loaded before a deploy loads the new version when a file of its own is gone', async () => {
  await owner.goto('/admin/')
  await expect(owner.getByRole('heading', { name: 'Inicio', level: 1 })).toBeVisible()
  // As a deploy leaves it: the file of a page of the version loaded answers 404, once.
  const file = /\/admin\/assets\/Tokens-[\w-]+\.js$/
  let asked = 0
  await owner.route(file, async (route) => {
    asked++
    if (asked === 1) await route.fulfill({ status: 404, body: '' })
    else await route.continue()
  })

  await owner.getByRole('link', { name: 'Tokens', exact: true }).click()
  await expect(owner.getByRole('heading', { name: 'Tokens', level: 1 })).toBeVisible()
  expect(asked).toBe(2)
  await owner.unroute(file)
})

test('the owner moves a draft to the trash from the editor, finds it there and restores it', async () => {
  // The admin is in Spanish since the tests before; Hello world is a draft again.
  await owner.goto('/admin/entries/blog/en/hello-world')
  await expect(owner.getByRole('heading', { name: 'Hello world', level: 1 })).toBeVisible()
  await owner.getByRole('button', { name: 'Mover a la papelera' }).click()
  await expect(owner.getByRole('dialog')).toContainText('¿Mover este borrador a la papelera?')
  await expectAccessible(owner)
  await owner.getByRole('dialog').getByRole('button', { name: 'Mover a la papelera' }).click()

  await expect(owner.getByText('Movida a la papelera', { exact: true }).first()).toBeVisible()
  await expect(owner.getByRole('heading', { name: 'Entradas', level: 1 })).toBeVisible()
  await expect(owner.getByRole('row', { name: /^Seleccionar Hola mundo/ })).toBeVisible()
  await expect(owner.getByRole('row', { name: /^Seleccionar Hello world/ })).toHaveCount(0)

  await owner.getByRole('combobox', { name: 'Estado' }).click()
  await owner.getByRole('option', { name: 'En la papelera' }).click()
  const trashed = owner.getByRole('row', { name: /^Seleccionar Hello world/ })
  await expect(trashed).toBeVisible()
  await expect(owner.getByRole('row', { name: /^Seleccionar Hola mundo/ })).toHaveCount(0)
  await expectAccessible(owner)
  await shot(owner, 'trash-es')

  await trashed.getByRole('button', { name: 'Restaurar Hello world' }).click()
  await expect(owner.getByText('1 restaurada', { exact: true }).first()).toBeVisible()
  await expect(owner.getByRole('row', { name: /^Seleccionar Hello world/ })).toHaveCount(0)
  await owner.getByRole('combobox', { name: 'Estado' }).click()
  await owner.getByRole('option', { name: 'Cualquier estado' }).click()
  await expect(owner.getByRole('row', { name: /^Seleccionar Hello world/ })).toContainText(
    'borrador',
  )

  // Both drafts go to the trash at once, after a confirmation, and come back at once.
  await owner.getByRole('checkbox', { name: 'Seleccionar Hello world' }).click()
  await owner.getByRole('checkbox', { name: 'Seleccionar Hola mundo, otra vez' }).click()
  const bar = owner.getByRole('toolbar', { name: 'Acciones sobre las filas seleccionadas' })
  await bar.getByRole('button', { name: 'Mover 2 a la papelera' }).click()
  await expect(owner.getByRole('dialog')).toContainText('¿Mover 2 borradores a la papelera?')
  await owner.getByRole('dialog').getByRole('button', { name: 'Mover 2 a la papelera' }).click()
  await expect(owner.getByText('2 movidas a la papelera', { exact: true }).first()).toBeVisible()
  await expect(owner.getByRole('row', { name: /^Seleccionar Hola mundo/ })).toHaveCount(0)

  await owner.getByRole('combobox', { name: 'Estado' }).click()
  await owner.getByRole('option', { name: 'En la papelera' }).click()
  await owner.getByRole('checkbox', { name: 'Seleccionar Hello world' }).click()
  await owner.getByRole('checkbox', { name: 'Seleccionar Hola mundo, otra vez' }).click()
  await bar.getByRole('button', { name: 'Restaurar 2' }).click()
  await expect(owner.getByText('2 restauradas', { exact: true }).first()).toBeVisible()
  await expect(owner.getByRole('row', { name: /^Seleccionar Hola mundo/ })).toHaveCount(0)
})

test('the bar of every page names the site it is of, with the menu to switch to another', async () => {
  // The admin is in Spanish since the tests before.
  await owner.goto('/admin/collections')
  const site = owner.getByRole('button', { name: 'Sitio playground: cambiar a otro' })
  await expect(site).toBeVisible()
  // Axe reads the page with no menu open: an open menu hides the rest of the page, as it should.
  await expectAccessible(owner)
  await site.click()
  await expect(owner.getByRole('menuitemcheckbox', { name: /playground/ })).toBeChecked()
  await owner.keyboard.press('Escape')
})

test('signing in goes back to a page of this Hollware, and never to another host (T-43)', async () => {
  // The owner's page holds the virtual passkey since the first test.
  await owner.goto('/signin?return_to=%2Fadmin%2Ftokens')
  await owner.getByRole('button', { name: 'Sign in with a passkey' }).click()
  await expect(owner).toHaveURL(/\/admin\/tokens$/)
  // The admin goes on loading (its session, then the page): the next visit waits for it to settle.
  await expect(owner.getByRole('heading', { name: 'Tokens', level: 1 })).toBeVisible()

  await owner.goto('/signin?return_to=%2F%5Cevil.example')
  await owner.getByRole('button', { name: 'Sign in with a passkey' }).click()
  await expect(owner).toHaveURL(new RegExp(`^${target().url}/admin/$`))
  await expect(owner.getByRole('heading', { name: 'Inicio', level: 1 })).toBeVisible()
})

test('the owner sees their passkey and the admin in Tu cuenta, then signs out (T-44, T-45, T-54)', async () => {
  // The admin is in Spanish since the tests before; the owner has the one passkey of setup. The
  // last test: signing out ends the session the tests before signed in with.
  await owner.goto('/admin/')
  await expect(owner.getByRole('heading', { name: 'Inicio', level: 1 })).toBeVisible()
  await owner.getByRole('button', { name: /^Olga/ }).click()
  await owner.getByRole('menuitem', { name: 'Tu cuenta' }).click()

  await expect(owner.getByRole('heading', { name: 'Tu cuenta', level: 1 })).toBeVisible()
  const passkeys = owner.getByRole('region', { name: 'Llaves de acceso' })
  await expect(passkeys.getByRole('button', { name: 'Quitar Passkey' })).toBeDisabled()
  await expect(
    passkeys.getByText('Tu última llave de acceso: agrega otra antes de quitarla.'),
  ).toBeVisible()
  const apps = owner.getByRole('region', { name: 'Aplicaciones conectadas' })
  await expect(apps.getByRole('row', { name: /Hollware admin\s*este admin/ })).toBeVisible()
  await expect(apps.getByRole('button', { name: /^Revocar/ })).toHaveCount(0)
  await expectAccessible(owner)
  await shot(owner, 'account-es')

  await owner.getByRole('button', { name: /^Olga/ }).click()
  await owner.getByRole('menuitem', { name: 'Cerrar sesión' }).click()
  await expect(owner.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()
  await expect(owner).toHaveURL(/\/signin\?return_to=%2Fadmin%2F$/)
  // The session is gone: the admin sends the browser to sign in again, not back in.
  await owner.goto('/admin/')
  await expect(owner).toHaveURL(/\/signin\?return_to=/)
})
