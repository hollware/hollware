---
'hollware': minor
'create-hollware': minor
'@hollware/server': minor
'@hollware/core': minor
---

Setting Hollware up from an agent: `hollware init` and `hollware token create` take `--token-file <path>` (mode 0600, refused when the file exists unless `--force`) and print its path instead of the token, and `create-hollware` passes it through. `--json` on `create-hollware`, `init`, `token create`, `invite` and `doctor` prints one JSON object and nothing else. `hollware dev` starts the project's local server, waits for `/health` and stays in the foreground until SIGINT or SIGTERM (`--detach` and `--stop` run it in the background), and `hollware mcp-config` prints the `claude mcp add` line or the JSON block of Claude Code, Cursor and VS Code, which name `HOLLWARE_TOKEN` and never the token. The output of `init` and `create-hollware` says the passkey link is for the admin and an agent starts with the token alone. `GET /v1` answers 200 with the URLs of the OpenAPI document and of `/v1/site`, with no token. `update_site` and `set_collection` answer `conflict` on a stale version with a `message` and a `fix` that say to call `get_structure` again.
