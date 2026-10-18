/**
 * The actions of the activity log (ADR-037). A line names one of these, and nothing else: a new
 * operation or route that changes something is not logged until it is named here.
 */

/** Every operation that is not a read: each call of one is a line, whatever its outcome. */
export const OPERATION_AUDIT_ACTIONS = [
  'create_draft',
  'update_draft',
  'publish',
  'unpublish',
  'move_entry',
  'schedule_unpublish',
  'delete_entry',
  'restore_entry',
  'restore_revision',
  'approve_review',
  'request_review',
  'comment_review',
  'request_changes',
  'update_site',
  'set_collection',
  'create_site',
  'delete_site',
  'restore_site',
  'make_webhook_secret',
  'upload_asset',
] as const

/** What people do outside the operations: their tokens, members, passkeys, sessions and apps. */
export const IDENTITY_AUDIT_ACTIONS = [
  'token.create',
  /** A person asked for a link that shows an entry's latest revision on the site (T-103). */
  'preview.create',
  'token.revoke',
  'member.role',
  'member.remove',
  'invitation.create',
  'invitation.accept',
  'session.sign_in',
  'session.sign_out',
  'session.end_all',
  'passkey.remove',
  'app.allow',
  'app.revoke',
  /** A refresh token was used again after it was spent, so its grant was revoked (T-34). */
  'app.refresh_reused',
  /** The cron published an entry whose time had come, for the person who scheduled it. */
  'schedule.publish',
  /** The cron unpublished an entry whose time had come, for the person who scheduled it. */
  'schedule.unpublish',
] as const

export const AUDIT_ACTIONS = [...OPERATION_AUDIT_ACTIONS, ...IDENTITY_AUDIT_ACTIONS] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** `denied`: a scope or a role was missing; `failed`: any other error the caller got. */
export const AUDIT_OUTCOMES = ['ok', 'denied', 'failed'] as const
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number]

/**
 * Who acted: a person in the admin, a personal token, an app a person allowed through OAuth, or
 * the deployment itself (its cron).
 */
export const AUDIT_ACTOR_KINDS = ['user', 'token', 'oauth_client', 'system'] as const
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number]

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value)
}
