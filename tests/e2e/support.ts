import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Locator, type Page } from '@playwright/test'

export function target(): { url: string; setup: string } {
  const url = process.env['HOLLWARE_E2E_URL']
  const setup = process.env['HOLLWARE_E2E_SETUP']
  if (url === undefined || setup === undefined) throw new Error('the global setup did not run')
  return { url, setup }
}

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

export async function setUp(page: Page, link: string, name: string): Promise<void> {
  await passkeyDevice(page)
  await page.goto(link)
  await expectAccessible(page)
  await page.getByLabel('Your name').fill(name)
  await page.getByRole('button', { name: 'Create the passkey' }).click()
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible()
}

export const AXE_EXCLUDED: readonly { readonly selector: string; readonly reason: string }[] = [
  {
    selector: '[role="region"][aria-label^="Notifications"] > span[aria-hidden="true"]',
    reason:
      "Reka's toast viewport (under Nuxt UI's UApp) frames its list with two focus guards, aria-hidden spans with tabindex 0 that send focus into the toasts; axe's aria-hidden-focus flags them, and they are not ours to change.",
  },
]

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

export async function writeMarkdown(page: Page, markdown: string): Promise<void> {
  const editor = page.locator('.cm-content').first()
  await expect(
    page.getByRole('textbox', {
      name: /^(Body of the entry|Cuerpo de la entrada|Markdown of the entry|Markdown de la entrada)$/,
    }),
  ).toBeVisible()
  if (!(await editor.isVisible())) {
    await page.getByRole('button', { name: /^(View Markdown|Ver Markdown)$/ }).click()
  }
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(markdown)
}

export async function saveNow(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+S')
  await expect(
    page.getByRole('status').filter({ hasText: /^\s*(Saved|Guardado)\s*$/ }),
  ).toBeVisible()
}

export async function openImagePicker(page: Page, after: string): Promise<Locator> {
  const body = page.getByRole('textbox', { name: /^(Body of the entry|Cuerpo de la entrada)$/ })
  await body.getByText(after).click()
  await expect(body).toBeFocused()
  await page.waitForTimeout(150)
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await page.getByRole('option', { name: /^(Image|Imagen)/ }).click()
  const picker = page.getByRole('dialog', { name: /^(Insert an image|Insertar una imagen)$/ })
  await expect(picker).toBeVisible()
  return picker
}

export async function entryAction(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: /^(More actions|Más acciones)$/ }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}

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
    `## In short`,
    '',
    'Plain words, one idea, and nothing that links anywhere.',
    '',
  ].join('\n')
}

export async function shot(page: Page, name: string): Promise<void> {
  const directory = process.env['HOLLWARE_SCREENSHOTS']
  if (directory === undefined || directory === '') return
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true })
}
