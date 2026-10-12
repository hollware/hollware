import {
  AuthorizationError,
  CimdFetchError,
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider'
import { SCOPES_SUPPORTED, SPIKE_USER_ID, type AuthProps } from './auth.ts'

export type Approval = { redirectTo: string } | { status: 400; message: string }

/**
 * The /authorize step of the spike: no sign-in and no consent page, every valid request is
 * approved for the spike user with the scopes it asked for that the server can grant.
 */
export async function approve(oauth: OAuthHelpers, request: Request): Promise<Approval> {
  try {
    const authRequest = await oauth.parseAuthRequest(request)
    const scope = authRequest.scope.filter((requested) => SCOPES_SUPPORTED.includes(requested))
    const props: AuthProps = { userId: SPIKE_USER_ID, scopes: scope, via: 'oauth' }
    const { redirectTo } = await oauth.completeAuthorization({
      request: authRequest,
      userId: SPIKE_USER_ID,
      metadata: {},
      scope,
      props,
    })
    return { redirectTo }
  } catch (error) {
    // With a redirect URI the client and the exact URI are validated: send the error back to it.
    if (error instanceof AuthorizationError && error.redirectTo !== undefined) {
      return { redirectTo: error.redirectTo }
    }
    // Without one the request cannot be trusted: render the error here, never redirect.
    if (error instanceof AuthorizationError) return { status: 400, message: error.description }
    if (error instanceof CimdFetchError)
      return { status: 400, message: 'This app could not be verified.' }
    throw error
  }
}
