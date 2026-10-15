/**
 * The pages a person sees to get in (ADR-026): set up a passkey from a link, and sign in. They
 * are rendered by the Worker, outside the admin's bundle, with one inline script under a nonce
 * and nothing framing them. The script uses the WebAuthn JSON methods of the browser
 * (`PublicKeyCredential.parseCreationOptionsFromJSON`, `credential.toJSON()`), and reads the
 * invitation from the address bar, so the page never prints it.
 */

const STYLE = `body{font:1rem/1.5 system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#1d1d1f}
label{display:block;margin:.75rem 0 .25rem}input{width:100%;padding:.5rem;font:inherit}
button{margin-top:1rem;padding:.6rem 1rem;font:inherit;cursor:pointer}[role=alert]{color:#b00020}`

const POST = `async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message + ' ' + (data.fix ?? ''))
  return data
}
function fail(error) { document.getElementById('error').textContent = error.message }`

function page(title: string, nonce: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Hollware</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${title}</h1>
${body}
<p id="error" role="alert"></p>
</main>
<script nonce="${nonce}">${POST}
${script}</script>
</body>
</html>
`
}

export function setupPage(nonce: string): string {
  return page(
    'Set up your passkey',
    nonce,
    `<p>A passkey lets you into this Hollware with your device's lock: no password.</p>
<form id="form">
<label for="name">Your name</label><input id="name" name="name" autocomplete="name">
<label for="label">This device</label><input id="label" name="label" value="Passkey">
<button type="submit">Create the passkey</button>
</form>`,
    `document.getElementById('form').addEventListener('submit', async (event) => {
  event.preventDefault()
  try {
    const invitation = new URLSearchParams(location.search).get('invitation') ?? ''
    const { challengeId, options } = await post('/auth/register/options', { invitation })
    const credential = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) })
    await post('/auth/register/verify', { challengeId, response: credential.toJSON(), name: document.getElementById('name').value, label: document.getElementById('label').value })
    location.href = '/admin/'
  } catch (error) { fail(error) }
})`,
  )
}

export function signInPage(nonce: string): string {
  return page(
    'Sign in',
    nonce,
    `<p>Sign in to this Hollware with your passkey.</p>
<button id="signin" type="button">Sign in with a passkey</button>`,
    `document.getElementById('signin').addEventListener('click', async () => {
  try {
    const { challengeId, options } = await post('/auth/signin/options', {})
    const credential = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) })
    await post('/auth/signin/verify', { challengeId, response: credential.toJSON() })
    const target = new URLSearchParams(location.search).get('return_to') ?? '/admin/'
    location.href = target.startsWith('/') && !target.startsWith('//') ? target : '/admin/'
  } catch (error) { fail(error) }
})`,
  )
}

/** The headers of a page: no framing, only its own script, and no caching. */
export function pageHeaders(nonce: string): Record<string, string> {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  }
}

/** Text for HTML: every string a client chose (its name, its redirect host, a scope) goes through it. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

/** What a scope lets a client do, in the words of the consent page. */
const SCOPE_WORDS: Readonly<Record<string, string>> = {
  'content:read': 'Read the content, drafts included',
  'content:write': 'Write drafts',
  'content:publish': 'Publish and unpublish',
  'schema:admin': 'Change the site settings',
}

export interface ConsentView {
  readonly clientName: string
  /** The domain of a client known by a metadata document; absent for one that registered itself. */
  readonly clientDomain?: string | undefined
  readonly redirectHost: string
  readonly redirectIsLoopback: boolean
  /** The person who is signed in. */
  readonly person: string
  /** The scopes the person may grant to this request, each offered checked. */
  readonly scopes: readonly string[]
  readonly handle: string
}

/**
 * The consent page of `/authorize` (ADR-026): which client asks, where the tokens go, and what it
 * may do, with Allow and Deny. It has no script, and it posts the handle that `beginConsent` bound
 * to this browser. Everything the client chose is escaped.
 */
export function consentPage(view: ConsentView): string {
  const name = escapeHtml(view.clientName)
  const origin =
    view.clientDomain === undefined
      ? '<p>This app registered itself: its name is not verified.</p>'
      : `<p>Published by <strong>${escapeHtml(view.clientDomain)}</strong>.</p>`
  const loopback = view.redirectIsLoopback
    ? '<p><strong>This sends access to an app on this computer.</strong> Continue only if you just started to connect it.</p>'
    : ''
  const scopes = view.scopes
    .map(
      (scope) =>
        `<label><input type="checkbox" name="scope" value="${escapeHtml(scope)}" checked> ${escapeHtml(SCOPE_WORDS[scope] ?? scope)} <code>${escapeHtml(scope)}</code></label>`,
    )
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Allow ${name} · Hollware</title>
<style>${STYLE}label input{width:auto;margin-right:.5rem}</style>
</head>
<body>
<main>
<h1>Allow ${name} to use this Hollware?</h1>
${origin}
<p>Signed in as <strong>${escapeHtml(view.person)}</strong>. Access goes to <strong>${escapeHtml(view.redirectHost)}</strong>.</p>
${loopback}
<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${escapeHtml(view.handle)}">
${scopes}
<p><button name="decision" value="approve">Allow</button> <button name="decision" value="deny">Deny</button></p>
</form>
</main>
</body>
</html>
`
}

/** A page that only says what went wrong and what to do. */
export function messagePage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Hollware</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</main>
</body>
</html>
`
}

/**
 * The headers of a page without a script: no framing and no caching. The form of the consent page
 * posts to `/authorize`, which redirects to the client, so `form-action` is not restricted: a
 * browser applies it to the redirect too.
 */
export function plainPageHeaders(): Record<string, string> {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  }
}
