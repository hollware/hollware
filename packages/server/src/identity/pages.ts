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
