export { registerShareModule, type ShareModuleDeps } from './routes.js';
export {
  type CreateShareLinkInput,
  createShareLink,
  getShareLinkById,
  getShareLinkByTokenHash,
  isRoleWithinCeiling,
  isShareLinkActive,
  revokeShareLinkById,
  type ShareLinkResourceType,
  type ShareLinkRow,
} from './shareLinks.js';
