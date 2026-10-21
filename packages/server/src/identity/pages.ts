/**
 * The pages a person sees to get in (ADR-026): set up a passkey from a link, and sign in. They
 * are rendered by the Worker, outside the admin's bundle, with one inline script under a nonce
 * and nothing framing them. The script uses the WebAuthn JSON methods of the browser
 * (`PublicKeyCredential.parseCreationOptionsFromJSON`, `credential.toJSON()`), and reads the
 * invitation from the fragment of the address, which no request carries, so neither the page nor
 * a log of a request ever holds it (T-55); a link of before 0.11, with it in the query, still works.
 */

/**
 * The look of hollware.com and the admin, with nothing to fetch: the page's policy loads no font,
 * so the type is the system's. Dark only, the Carbón greys of the theme and its flame for the
 * primary color and the mark (ADR-039, tests/conventions/brand.test.ts).
 */
const STYLE = `:root{color-scheme:dark;--bg:#0e0c0a;--card:#17140f;--fg:#f2ede4;--muted:#9e968a;--line:rgb(255 255 255/.1);--accent:#f0a93b;--on-accent:#0e0c0a;--mark:#f0a93b;--danger:#e5675c}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem 1rem;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:26rem;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:2rem}
.brand{display:flex;align-items:center;gap:.6rem;margin-bottom:1.75rem;font-weight:700;letter-spacing:-.045em}.brand svg{width:auto;height:26px}
h1{font-size:1.4rem;line-height:1.25;letter-spacing:-.02em;margin:0 0 .5rem}p{color:var(--muted);margin:.5rem 0}strong{color:var(--fg)}
label{display:block;margin:1rem 0 .35rem;font-size:.9rem;font-weight:500}fieldset label,form>label:has(input[type=checkbox]){font-weight:400;display:flex;align-items:center;gap:.5rem;margin:.5rem 0}
input{width:100%;padding:.6rem .75rem;font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:8px}input:focus{outline:2px solid var(--accent);outline-offset:1px}
label input{width:auto;margin:0}fieldset{border:1px solid var(--line);border-radius:8px;margin:1rem 0;padding:.5rem .9rem}legend{color:var(--muted);font-size:.85rem;padding:0 .3rem}
code{font:.82em ui-monospace,'SF Mono',Menlo,monospace;color:var(--muted)}
button{margin-top:1.25rem;padding:.6rem 1rem;font:inherit;font-weight:500;cursor:pointer;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--fg)}
button:not([value=deny]){background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
[role=alert]{color:var(--danger)}`

/**
 * The SHA-256 of STYLE, base64: the policy of every page allows that one stylesheet and no other
 * inline style (a test computes it again from STYLE, so the two cannot part).
 */
export const STYLE_HASH = 'sha256-caUN4ZvB7+wd4+mmGJIGrYN04KxctcbogVYBfvIZv7o='

/**
 * What every page of the Worker says besides its policy: no window of another origin keeps a hold
 * on it, no other origin embeds it, and it asks for no device.
 */
export const PAGE_ISOLATION: Readonly<Record<string, string>> = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()',
}

/** The mark of Hollware, before the title of every page. */
const BRAND = `<div class="brand"><svg viewBox="0 0 204 243" aria-hidden="true"><path fill="var(--mark)" fill-rule="evenodd" d="M109.3 17.8 C101.9 25.0 98.5 35.8 100.9 44.7 C102.3 49.9 108.5 57.8 114.2 61.7 C139.7 79.0 149.8 88.1 158.8 102.0 C167.7 115.8 173.7 137.1 172.5 150.5 C170.4 172.6 163.0 189.2 148.6 203.6 C137.8 214.3 126.3 221.1 112.9 224.5 C104.2 226.8 104.0 226.4 111.5 221.4 C119.6 216.2 123.8 212.3 128.5 206.0 C133.9 198.6 136.9 189.4 132.7 192.8 C129.7 195.3 117.7 201.0 115.5 201.0 C114.2 201.0 111.7 202.5 109.7 204.5 C105.3 208.9 103.4 208.9 101.6 204.5 C101.1 203.33 100.6 202.17 100.1 201.0 C97.13 201.0 94.17 201.0 91.2 201.0 C88.27 201.0 85.33 201.0 82.4 201.0 C81.83 202.17 81.27 203.33 80.7 204.5 C79.8 206.4 78.5 208.0 77.9 208.0 C77.2 208.0 75.0 206.2 73.0 204.0 C70.9 201.7 68.4 200.0 67.1 200.0 C64.1 200.0 53.0 195.3 50.4 192.9 C47.6 190.3 46.7 190.5 47.5 193.7 C49.8 203.2 61.9 216.2 74.3 222.7 C78.8 225.0 76.1 225.5 69.3 223.5 C44.9 216.4 23.5 195.2 17.6 172.3 C15.6 164.8 15.6 151.3 17.4 144.3 C20.6 132.5 32.0 117.3 42.1 111.4 C45.1 109.7 51.3 106.1 55.9 103.4 C60.4 100.7 65.8 97.0 67.7 95.1 C68.9 93.93 70.1 92.77 71.3 91.6 C71.07 93.2 70.83 94.8 70.6 96.4 C70.2 99.0 68.7 104.1 67.4 107.8 C60.6 125.7 64.4 137.8 78.3 142.5 C82.3 143.8 83.2 143.8 86.6 142.4 C88.8 141.5 92.4 139.0 94.8 136.7 C102.1 129.6 103.7 119.4 100.0 103.5 C97.4 92.6 92.8 83.5 84.6 73.5 C76.5 63.7 74.5 58.3 75.3 49.3 C76.6 35.8 89.3 21.7 105.4 16.0 C113.0 13.3 113.7 13.6 109.3 17.8 Z M137.2 151.8 C131.3 160.9 124.4 166.8 109.2 175.9 C100.9 180.9 100.3 181.5 102.1 183.7 C106.2 188.6 121.0 191.0 129.2 188.1 C138.2 185.1 145.0 174.2 145.0 163.0 C145.0 158.1 142.6 148.5 141.1 147.5 C140.6 147.3 138.8 149.1 137.2 151.8 Z M41.2 155.2 C38.6 162.7 38.5 164.9 40.6 171.9 C43.2 180.8 51.5 188.1 60.8 189.6 C69.1 190.9 81.0 186.3 81.0 181.7 C81.0 181.0 79.3 179.6 77.3 178.6 C68.6 174.5 54.8 163.8 50.4 157.8 C48.0 154.5 46.0 151.2 46.0 150.4 C46.0 149.6 45.4 149.0 44.7 149.0 C44.0 149.0 42.4 151.8 41.2 155.2 Z"/></svg>hollware</div>`

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

/**
 * The invitation of a setup link: in its fragment (`#invitation=…`), which a browser never sends,
 * so no log of a request holds it (T-55); or, in a link made before 0.11, in its query. The page
 * runs its source as it is: it uses nothing but its arguments and the URL of the platform.
 */
export function invitationOf(hash: string, search: string): string {
  return (
    new URLSearchParams(hash.replace(/^#/, '')).get('invitation') ??
    new URLSearchParams(search).get('invitation') ??
    ''
  )
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
    `const invitationOf = ${invitationOf.toString()}
document.getElementById('form').addEventListener('submit', async (event) => {
  event.preventDefault()
  try {
    const invitation = invitationOf(location.hash, location.search)
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
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src '${STYLE_HASH}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...PAGE_ISOLATION,
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
    'content-security-policy': `default-src 'none'; style-src '${STYLE_HASH}'; base-uri 'none'; frame-ancestors 'none'`,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...PAGE_ISOLATION,
  }
}
