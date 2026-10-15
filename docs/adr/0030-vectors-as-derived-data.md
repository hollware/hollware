# ADR-030: Vectors as derived data

Status: Accepted (2026-10-15)

## Context

Semantic search finds an entry by what it means, across languages: a Spanish question can find an English post. It needs a model that turns text into vectors and an index that finds the nearest ones. On Cloudflare those are Workers AI and Vectorize. Neither has a local emulation, both cost money past their free allowance, and a project made by `create-hollware` has to run with no Cloudflare login. Full-text search (ADR-029) already covers every deployment.

## Decision

- **Semantic search is optional.** A Worker with an `AI` and a `VECTORIZE` binding has it; a Worker without either has full-text search only, and nothing else changes. The starter declares neither.
- **Vectors are derived data**, like the Comark document of a revision: they can always be made again from what is published. `entry_embeddings` (migration `0009_embeddings.sql`) records, for each entry, the revision, the model and the chunker version of its vectors and how many pieces it has. A vector's id is `<entry id>:<piece>`, and its metadata holds the site, the entry, the collection, the locale and the piece.
- **The pieces** (`chunksOf` in `@hollware/core`) are one summary (title, description and the text before the first `h2`) and one piece per `h2` section, each cut at a word. A change to the chunker bumps `CHUNKER_VERSION`.
- **An internal subscriber, `vectors`, keeps them** on the events of the outbox (ADR-025). It reads the entry as it is now, so it is right however late it runs and whichever event called it: the vectors of the published revision are made once, an entry with nothing published loses them, and a revision with fewer sections drops the vectors of the sections it lost. A failure is retried as any delivery is.
- **The cron trigger heals what no event did**: entries published before the Worker had semantic search, vectors of another model or chunker, and vectors of entries that are no longer published, a few entries a minute.
- **Two ports, `Embedder` and `VectorIndex`**, with adapters over the bindings and deterministic fakes in tests, so no test reaches the network.

## Consequences

- Turning semantic search on, or changing the model, needs no command: the cron indexes the site within minutes of the deploy.
- A Vectorize index serves one model, since its dimensions are fixed: changing the model means a new index.
- A write costs no embedding; publishing costs one call to the model per entry, outside the request.

## Alternatives considered

- Embedding in the publish request. Rejected: the request would wait on a model, and a failure would have to fail the publish or be lost.
- Embedding in a Workflow or a Durable Object. Rejected: neither reaches the remote AI and Vectorize bindings in local development, and the outbox already retries.
- Making the bindings required. Rejected: every project would need a Cloudflare login to start and would pay for what it may not use.
