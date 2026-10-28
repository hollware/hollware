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
  'reject_review',
  'update_site',
  'set_collection',
  'create_site',
  'delete_site',
  'restore_site',
  'make_webhook_secret',
  'connect_analytics',
  'disconnect_analytics',
  'upload_asset',
  'update_asset',
] as const

/**
 * What happens outside the operations: the tokens, members, passkeys, sessions and apps of people,
 * the scheduled publications, the events given up on and sent again, and the entries purged.
 */
export const IDENTITY_AUDIT_ACTIONS = [
  'token.create',
  'preview.create',
  'token.revoke',
  'member.role',
  'member.remove',
  'member.anonymize',
  'invitation.create',
  'invitation.revoke',
  'invitation.accept',
  'session.sign_in',
  'session.sign_out',
  'session.end_all',
  'passkey.remove',
  'passkey.rename',
  'account.rename',
  'app.allow',
  'app.revoke',
  'app.refresh_reused',
  'event.abandon',
  'event.retry',
  'entry.purge',
  'schedule.publish',
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
