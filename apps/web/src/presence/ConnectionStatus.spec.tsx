import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
// Side-effect import — initializes the shared i18next singleton. Default language is pt-BR.
import '../i18n/index.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import { createPresenceStore } from './presenceStore.js';

afterEach(() => {
  cleanup();
});

describe('ConnectionStatus (T10, LIVE-24/25)', () => {
  it('renders the connecting text while the socket is being opened (LIVE-24)', () => {
    render(<ConnectionStatus store={createPresenceStore('connecting')} />);
    expect(screen.getByTestId('presence-connection-status').textContent).toBe(
      'Conectando à presença ao vivo…',
    );
  });

  it('renders a distinct text once connected (LIVE-24)', () => {
    render(<ConnectionStatus store={createPresenceStore('connected')} />);
    expect(screen.getByTestId('presence-connection-status').textContent).toBe(
      'Presença ao vivo conectada',
    );
  });

  it('renders a distinct text once disconnected (LIVE-24)', () => {
    render(<ConnectionStatus store={createPresenceStore('disconnected')} />);
    expect(screen.getByTestId('presence-connection-status').textContent).toBe(
      'Presença ao vivo desconectada',
    );
  });

  it('is an aria-live polite region whose text updates in place on a phase change (LIVE-25)', () => {
    const store = createPresenceStore('connecting');
    render(<ConnectionStatus store={store} />);

    const region = screen.getByTestId('presence-connection-status');
    expect(region.getAttribute('aria-live')).toBe('polite');

    act(() => {
      store.getState().setConnection('disconnected');
    });

    // Same DOM node, new text: the announcement region is never remounted, which
    // is what makes a polite live region actually announce the change.
    expect(screen.getByTestId('presence-connection-status')).toBe(region);
    expect(region.textContent).toBe('Presença ao vivo desconectada');
  });
});
