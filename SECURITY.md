# Security policy

Hollware is pre-alpha and is not ready for production use. Security reports are still welcome, and they are taken seriously.

## Reporting a vulnerability

Report vulnerabilities **privately**, through GitHub's [private vulnerability reporting](https://github.com/hollware/hollware/security/advisories/new): open the repository's **Security** tab and choose **Report a vulnerability**. That is the only channel.

**Never open a public issue, discussion or pull request for a vulnerability**, and do not share details anywhere public until a fix has been released.

A useful report includes:

- The affected package and version, or the commit.
- What an attacker can do, and under what conditions.
- Steps to reproduce, or a proof of concept.
- Whether the problem is already public or known to others.
- A suggested fix or mitigation, if you have one.

## Supported versions

Hollware is pre-1.0. Only the **latest 0.x minor release** receives security fixes. Older minor releases do not. This section will be updated with the support policy for stable releases when 1.0 ships.

## Scope

In scope:

- The packages published from this repository: every `@hollware/*` package, `hollware` and `create-hollware`.
- The templates in this repository, such as the starter project that `create-hollware` copies. An insecure default in a template counts.
- The repository's build and release automation, for example anything that could let someone publish a package they should not.

Examples of what we want to hear about: bypassing authentication or scopes, reading or writing another site's content in a shared deployment, reading unpublished content without permission, injection or script execution through content handling, server-side request forgery, leaked secrets or tokens, and tampering with how packages are built or published.

Out of scope:

- The configuration of your own Cloudflare account: who has access to it, the API tokens you create, your routes, DNS and firewall rules, and what you expose through your bindings. Hollware deploys into your account, and securing that account is your responsibility.
- Vulnerabilities in Cloudflare's platform or in third-party dependencies. Report those to their maintainers. If the way Hollware uses a dependency makes it exploitable, tell us as well.
- Reports without a demonstrated security impact, such as raw scanner output or theoretical issues without a proof of concept.
- Volumetric denial of service, that is, overwhelming a deployment with traffic.

Test only against your own deployment or a local checkout, never against someone else's. Do not access, change or delete data that is not yours.

## What to expect

Hollware has a single maintainer, so these are best-effort targets, not guarantees:

- We acknowledge your report within **7 days**.
- After that, we tell you whether we can reproduce the problem and how we assess it, and we keep you updated until it is resolved.
- We work on the fix privately and release it as a new version.
- There is no bug bounty program.

## Coordinated disclosure

We follow coordinated disclosure. Please keep the details private until the fix has been released and the advisory is published. We will agree on a date with you.

When the fix ships, we publish a GitHub security advisory, request a CVE if the issue warrants one, and credit you for the discovery unless you prefer to stay anonymous.
