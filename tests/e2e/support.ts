import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/** Where the Worker is, and the owner's setup link, from the global setup. */
export function target(): { url: string; setup: string } {
  const url = process.env['HOLLWARE_E2E_URL']
  const setup = process.env['HOLLWARE_E2E_SETUP']
  if (url === undefined || setup === undefined) throw new Error('the global setup did not run')
  return { url, setup }
}

/**
 * A passkey device for the page: Chromium's virtual authenticator (CDP), which keeps the
 * credentials it makes and says yes when asked, as a person's device does after Touch ID.
 */
export async function passkeyDevice(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
}

/** Sets up a passkey through a link, as a person does on the setup page, and lands in the admin. */
export async function setUp(page: Page, link: string, name: string): Promise<void> {
  await passkeyDevice(page)
  await page.goto(link)
  await expectAccessible(page)
  await page.getByLabel('Your name').fill(name)
  await page.getByRole('button', { name: 'Create the passkey' }).click()
  await expect(page.getByRole('heading', { name: 'Entries', level: 1 })).toBeVisible()
}

/**
 * What axe does not look at, each with why. The list only shrinks: a page of the admin that needs
 * an entry here needs a reason a reviewer accepts.
 */
export const AXE_EXCLUDED: readonly { readonly selector: string; readonly reason: string }[] = [
  {
    selector: '[role="region"][aria-label^="Notifications"] > span[aria-hidden="true"]',
    reason:
      "Reka's toast viewport (under Nuxt UI's UApp) frames its list with two focus guards, aria-hidden spans with tabindex 0 that send focus into the toasts; axe's aria-hidden-focus flags them, and they are not ours to change.",
  },
]

/** Axe finds nothing serious or critical on the page (AC-0.3-4). */
export async function expectAccessible(page: Page): Promise<void> {
  let builder = new AxeBuilder({ page })
  for (const { selector } of AXE_EXCLUDED) builder = builder.exclude(selector)
  const results = await builder.analyze()
  const blocking = results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes
          .map(
            (node) =>
              `${node.target.join(' ')} [${node.failureSummary ?? ''}] ${node.html.slice(0, 200)}`,
          )
          .join(' | ')}`,
    )
  expect(blocking).toEqual([])
}

/** Replaces the Markdown in the editor, as a person who selects all and types does. */
export async function writeMarkdown(page: Page, markdown: string): Promise<void> {
  const editor = page.locator('.cm-content').first()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(markdown)
}

/** A post the blog of the playground takes, with no links, so it has nothing to warn about. */
export function post(title: string, group: string): string {
  return [
    '---',
    `title: ${title}`,
    'description: A post that the end-to-end tests write, short and plain.',
    'date: 2026-10-15',
    'tags:',
    '  - e2e',
    `translationGroup: ${group}`,
    '---',
    '',
    `# ${title}`,
    '',
    'Plain words, one idea, and nothing that links anywhere.',
    '',
  ].join('\n')
}

/**
 * A screenshot of the page, full length, into the directory of HOLLWARE_SCREENSHOTS when it is
 * set, to look at the admin by eye; nothing otherwise.
 */
export async function shot(page: Page, name: string): Promise<void> {
  const directory = process.env['HOLLWARE_SCREENSHOTS']
  if (directory === undefined || directory === '') return
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true })
}
