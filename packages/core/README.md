# @hollware/core

The contracts, operation specs, schemas and Markdown pipeline of
[Hollware](https://github.com/hollware/hollware), an open-source headless CMS for the agent era,
native to Cloudflare Workers.

> **Status: pre-alpha, not usable yet.** This release only reserves the package name and
> exports its own name. There is no API to depend on, and everything will change.

## What it will be

The runtime-agnostic heart of Hollware: the definitions of config, collections and
components, the contracts that validate every write, the specs of every operation (name,
input and output schemas, scopes and effect) and the Markdown pipeline. It has no Cloudflare
dependencies, so it runs anywhere, and a client can import the operation types without the
Worker.

## Links

- Repository: <https://github.com/hollware/hollware>
- Issues: <https://github.com/hollware/hollware/issues>
- License: MIT
