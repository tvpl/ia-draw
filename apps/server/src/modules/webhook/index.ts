export { registerWebhookModule, type WebhookModuleDeps } from './routes.js';
export {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookEndpointById,
  isWebhookEventType,
  listEnabledWebhookEndpointsForEvent,
  listWebhookEndpointsForWorkspace,
  rotateWebhookSecret,
  updateWebhookEndpoint,
  WEBHOOK_EVENT_TYPES,
  type WebhookEndpointRow,
  type WebhookEventType,
} from './webhooks.js';
