/**
 * The pages a person sees to get in (ADR-026): set up a passkey from a link, and sign in. They
 * are rendered by the Worker, outside the admin's bundle, with one inline script under a nonce
 * and nothing framing them. The script uses the WebAuthn JSON methods of the browser
 * (`PublicKeyCredential.parseCreationOptionsFromJSON`, `credential.toJSON()`), and reads the
 * invitation from the address bar, so the page never prints it.
 */

/**
 * The look of hollware.com and the admin, with nothing to fetch: the page's policy loads no font,
 * so the type is the system's. Dark only, the neutral greys of the theme, white as the primary
 * color and emerald for the mark (tests/conventions/brand.test.ts).
 */
const STYLE = `:root{color-scheme:dark;--bg:#0a0a0a;--card:#171717;--fg:#f5f5f5;--muted:#a3a3a3;--line:rgb(255 255 255/.1);--accent:#fafafa;--on-accent:#0a0a0a;--mark:#34d399;--danger:#ff8a80}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem 1rem;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:26rem;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:2rem}
.brand{display:flex;align-items:center;gap:.6rem;margin-bottom:1.75rem;font-weight:600;letter-spacing:-.01em}.brand svg{width:26px;height:26px}
h1{font-size:1.4rem;line-height:1.25;letter-spacing:-.02em;margin:0 0 .5rem}p{color:var(--muted);margin:.5rem 0}strong{color:var(--fg)}
label{display:block;margin:1rem 0 .35rem;font-size:.9rem;font-weight:500}fieldset label,form>label:has(input[type=checkbox]){font-weight:400;display:flex;align-items:center;gap:.5rem;margin:.5rem 0}
input{width:100%;padding:.6rem .75rem;font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:8px}input:focus{outline:2px solid var(--accent);outline-offset:1px}
label input{width:auto;margin:0}fieldset{border:1px solid var(--line);border-radius:8px;margin:1rem 0;padding:.5rem .9rem}legend{color:var(--muted);font-size:.85rem;padding:0 .3rem}
code{font:.82em ui-monospace,'SF Mono',Menlo,monospace;color:var(--muted)}
button{margin-top:1.25rem;padding:.6rem 1rem;font:inherit;font-weight:500;cursor:pointer;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--fg)}
button:not([value=deny]){background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
[role=alert]{color:var(--danger)}`

/** The mark of Hollware, before the title of every page. */
const BRAND = `<div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="currentColor" opacity=".08"/><path d="M9 8v16M23 8v16M9 16h14" stroke="var(--mark)" stroke-width="3" stroke-linecap="round" fill="none"/></svg>Hollware</div>`

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
${BRAND}
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

/**
 * Where the sign-in page sends the person after their passkey: the `return_to` it was given, if it
 * is a page of this origin, else the admin. The target is read as the browser will read it, as a
 * URL against the page's own origin, so no way of writing another host (`//`, `/\`, a tab, a
 * scheme) gets through, and only the path, query and fragment it resolves to are used (T-43).
 * The page runs its source as it is: it uses nothing but its arguments and the URL of the platform.
 */
export function sameOriginTarget(target: string | null, origin: string): string {
  if (target === null) return '/admin/'
  try {
    const url = new URL(target, origin)
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : '/admin/'
  } catch {
    return '/admin/'
  }
}

export function signInPage(nonce: string): string {
  return page(
    'Sign in',
    nonce,
    `<p>Sign in to this Hollware with your passkey.</p>
<button id="signin" type="button">Sign in with a passkey</button>`,
    `const sameOriginTarget = ${sameOriginTarget.toString()}
document.getElementById('signin').addEventListener('click', async () => {
  try {
    const { challengeId, options } = await post('/auth/signin/options', {})
    const credential = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) })
    await post('/auth/signin/verify', { challengeId, response: credential.toJSON() })
    location.href = sameOriginTarget(new URLSearchParams(location.search).get('return_to'), location.origin)
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
  /** The sites the grant may be for: one is sent as it is; several are a choice, the first checked. */
  readonly sites: readonly string[]
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
  const sites =
    view.sites.length === 1
      ? `<input type="hidden" name="site" value="${escapeHtml(view.sites[0] ?? '')}">`
      : `<fieldset><legend>For the site</legend>${view.sites
          .map(
            (site, index) =>
              `<label><input type="radio" name="site" value="${escapeHtml(site)}"${index === 0 ? ' checked' : ''}> ${escapeHtml(site)}</label>`,
          )
          .join('\n')}</fieldset>`
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
<style>${STYLE}</style>
</head>
<body>
<main>
${BRAND}
<h1>Allow ${name} to use this Hollware?</h1>
${origin}
<p>Signed in as <strong>${escapeHtml(view.person)}</strong>. Access goes to <strong>${escapeHtml(view.redirectHost)}</strong>.</p>
${loopback}
<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${escapeHtml(view.handle)}">
${sites}
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
${BRAND}
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
