import { expect, it } from 'vite-plus/test'

import * as auth from '../../src/auth/index.ts'

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
