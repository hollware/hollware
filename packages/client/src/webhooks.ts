/**
 * The signature of Hollware's webhooks (ADR-025), on its own: `@hollware/client/webhooks` imports
 * no zod and nothing else, so a site whose own zod is another major can check a delivery.
 */
export {
  EVENT_ID_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signWebhook,
  verifyWebhook,
  type WebhookCheck,
} from '@hollware/core/webhooks'
