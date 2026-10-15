/**
 * What a page sends to count a view (ADR-031): the site and the path, nothing else. It goes with
 * `fetch` and not `navigator.sendBeacon`, so that it can leave cookies out: `credentials: 'omit'`.
 * `keepalive` lets it finish when the page is left; `no-cors` with a text body needs no preflight,
 * and the page never reads the answer.
 */
export function sendView(
  send: (url: string, init: RequestInit) => Promise<unknown>,
  hollwareUrl: string,
  site: string,
  path: string,
): void {
  void send(`${hollwareUrl.replace(/\/+$/, '')}/events`, {
    method: 'POST',
    body: JSON.stringify({ site, path }),
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    credentials: 'omit',
    keepalive: true,
    mode: 'no-cors',
  }).catch(() => {
    // A view that was not counted is no error of the page.
  })
}
