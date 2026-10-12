import { expect, it } from 'vite-plus/test'

import * as auth from '../../src/auth/index.ts'

// Fails when: src/auth/index.ts stops exporting one of the pieces the gateway composes, or starts
// exporting one that it does not mean to hand out (`recordTokenUse`, `parseTokenScopes` and
// `authErrorResponse` are for the module's own use and its tests). The types it exports are
// checked by `vp check` wherever the gateway imports them.

it('exports what the gateway composes, and nothing else', () => {
  expect(Object.keys(auth).sort()).toEqual([
    'ROLES',
    'ROLE_SCOPES',
    'checkHostAndOrigin',
    'checkPersonalToken',
    'effectiveScopes',
    'insufficientScope',
    'isRole',
    'missingScopes',
    'readBearerToken',
    'unauthorized',
  ])
})
