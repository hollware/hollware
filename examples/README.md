# Examples

Sites that consume Hollware. Each directory is a project of its own that reads published
content from a Hollware instance, the way a real site would.

`examples/worker-site` is a blog on a Cloudflare Worker. It reads published entries over a
service binding to a Hollware Worker (Workers RPC): a listing by locale and tag, and the HTML of an
entry rendered from its stored document.
