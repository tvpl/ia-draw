import { describe, expect, it } from 'vitest';
import {
  type AiDockPhase,
  aiDockStatusTranslationKey,
  createAiDockStore,
  type PreviewSummary,
} from './aiDockStore.js';

const PREVIEW: PreviewSummary = {
  added: ['el-1'],
  removed: [],
  moved: [],
  modified: [],
  metadataChanged: [],
};

function makeStore() {
  return createAiDockStore();
}

describe('aiDockStatusTranslationKey', () => {
  it('mirrors saveStatusTranslationKey’s "block.kind" shape for every phase', () => {
    const phases: AiDockPhase[] = [
      'idle',
      'submitting',
      'awaiting_approval',
      'approving',
      'applied',
      'restoring',
      'error',
      'rate_limited',
      'expired',
    ];
    for (const phase of phases) {
      expect(aiDockStatusTranslationKey(phase)).toBe(`aiDock.status.${phase}`);
    }
  });
});

describe('createAiDockStore', () => {
  it('starts idle with empty/null fields', () => {
    const store = makeStore();
    expect(store.getState()).toMatchObject({
      phase: 'idle',
      requestText: '',
      run: null,
      preview: null,
      requiresExplicitApproval: false,
      errorCode: null,
      lastSnapshotId: null,
      rateLimitedUntil: null,
    });
  });

  it('setRequestText updates requestText only', () => {
    const store = makeStore();
    store.getState().setRequestText('draw three services');
    expect(store.getState().requestText).toBe('draw three services');
  });

  it('submitStart -> submitting, clearing any stale error/preview from a previous attempt', () => {
    const store = makeStore();
    store.getState().submitFailed('unknown');
    store.getState().submitStart();
    expect(store.getState()).toMatchObject({
      phase: 'submitting',
      errorCode: null,
      run: null,
      preview: null,
    });
  });

  it('submitSuccess -> awaiting_approval with run/preview/requiresExplicitApproval set', () => {
    const store = makeStore();
    store.getState().submitSuccess({
      run: { id: 'run-1', status: 'awaiting_approval' },
      preview: PREVIEW,
      requiresExplicitApproval: true,
    });
    expect(store.getState()).toMatchObject({
      phase: 'awaiting_approval',
      run: { id: 'run-1', status: 'awaiting_approval' },
      preview: PREVIEW,
      requiresExplicitApproval: true,
    });
  });

  it('submitFailed -> error with the errorCode set, requestText preserved (DOCK-10)', () => {
    const store = makeStore();
    store.getState().setRequestText('a request worth keeping');
    store.getState().submitFailed('no_provider_configured');
    expect(store.getState()).toMatchObject({
      phase: 'error',
      errorCode: 'no_provider_configured',
      requestText: 'a request worth keeping',
    });
  });

  it('rateLimited -> rate_limited with rateLimitedUntil set, requestText preserved (DOCK-05)', () => {
    const store = makeStore();
    store.getState().setRequestText('still here');
    const until = Date.now() + 60_000;
    store.getState().rateLimited(until);
    expect(store.getState()).toMatchObject({
      phase: 'rate_limited',
      rateLimitedUntil: until,
      requestText: 'still here',
    });
  });

  it('approveStart -> approving', () => {
    const store = makeStore();
    store.getState().approveStart();
    expect(store.getState().phase).toBe('approving');
  });

  it('approveSuccess -> applied with lastSnapshotId set', () => {
    const store = makeStore();
    store.getState().approveSuccess('snapshot-1');
    expect(store.getState()).toMatchObject({ phase: 'applied', lastSnapshotId: 'snapshot-1' });
  });

  it('approveConflict -> idle with preview cleared and requestText preserved (DOCK-15)', () => {
    const store = makeStore();
    store.getState().setRequestText('resend me');
    store.getState().submitSuccess({
      run: { id: 'run-2', status: 'awaiting_approval' },
      preview: PREVIEW,
      requiresExplicitApproval: false,
    });
    store.getState().approveConflict();
    expect(store.getState()).toMatchObject({
      phase: 'idle',
      preview: null,
      run: null,
      requestText: 'resend me',
    });
  });

  it('cancelled -> idle', () => {
    const store = makeStore();
    store.getState().submitSuccess({
      run: { id: 'run-3', status: 'awaiting_approval' },
      preview: PREVIEW,
      requiresExplicitApproval: false,
    });
    store.getState().cancelled();
    expect(store.getState().phase).toBe('idle');
  });

  it('undoStart -> restoring', () => {
    const store = makeStore();
    store.getState().undoStart();
    expect(store.getState().phase).toBe('restoring');
  });

  it('undoSuccess -> idle, clearing lastSnapshotId (DOCK-20: only the most recently applied run)', () => {
    const store = makeStore();
    store.getState().approveSuccess('snapshot-2');
    store.getState().undoStart();
    store.getState().undoSuccess();
    expect(store.getState()).toMatchObject({ phase: 'idle', lastSnapshotId: null });
  });

  it('undoFailed -> still offering undo (back to applied, lastSnapshotId untouched, never reports success) (DOCK-19)', () => {
    const store = makeStore();
    store.getState().approveSuccess('snapshot-3');
    store.getState().undoStart();
    store.getState().undoFailed();
    expect(store.getState()).toMatchObject({ phase: 'applied', lastSnapshotId: 'snapshot-3' });
  });

  it('reset -> idle, back to the full initial state', () => {
    const store = makeStore();
    store.getState().setRequestText('something');
    store.getState().submitSuccess({
      run: { id: 'run-4', status: 'awaiting_approval' },
      preview: PREVIEW,
      requiresExplicitApproval: true,
    });
    store.getState().approveSuccess('snapshot-4');
    store.getState().reset();
    expect(store.getState()).toMatchObject({
      phase: 'idle',
      requestText: '',
      run: null,
      preview: null,
      requiresExplicitApproval: false,
      errorCode: null,
      lastSnapshotId: null,
      rateLimitedUntil: null,
    });
  });
});
