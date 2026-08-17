import type { PresenceSocket } from './presenceClient.js';

/**
 * Hand-written `PresenceSocket` double (design.md, Fork 3 — chosen over a
 * `mock-socket`/`ws` devDependency). Tests drive it explicitly: nothing here
 * happens on a timer, so socket lifecycle assertions stay deterministic.
 *
 * Lives in `src/` rather than a test file because two spec files need it
 * (`presenceClient.spec.ts` and `DiagramEditorPage.spec.tsx`).
 */
export class FakeSocket implements PresenceSocket {
  static instances: FakeSocket[] = [];

  readonly url: string;
  readonly sent: string[] = [];
  readyState = 0;
  closedWith: number | undefined;

  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  static reset(): void {
    FakeSocket.instances = [];
  }

  static get last(): FakeSocket | undefined {
    return FakeSocket.instances.at(-1);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.readyState = 3;
    this.closedWith = code;
  }

  /** Simulates the server accepting the upgrade. */
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  /** Simulates one inbound frame. */
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }

  /** Simulates the connection dropping, from either side. */
  emitClose(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}
