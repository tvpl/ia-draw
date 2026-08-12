export {
  bulkReorderFrames,
  createFrame,
  deleteFrame,
  type FrameRow,
  getFrameById,
  InvalidNavLinkError,
  listFramesForPresentation,
  type NavLink,
  UnknownFrameIdError,
  updateFrame,
} from './frames.js';
export {
  createPresentation,
  getPresentationById,
  getPresentationDiagramId,
  listPresentationsForDiagram,
  type PresentationRow,
  setPublishedSnapshot,
  updatePresentation,
} from './presentations.js';
export { type PresentationModuleDeps, registerPresentationModule } from './routes.js';
