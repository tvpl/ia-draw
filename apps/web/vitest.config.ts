import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    /**
     * GATE-04: um teste inteiro tem 15 s, e cada espera assíncrona da Testing Library tem 5 s
     * (`vitest.setup.ts`). A ordem entre os dois é o que importa: com os dois iguais, uma
     * espera que estoura consome o orçamento do teste e o erro que aparece é o timeout opaco
     * do vitest — "Test timed out in 5000ms" — em vez da mensagem da Testing Library dizendo
     * qual elemento não apareceu e o que havia na tela. O limite maior não é tolerância a
     * teste lento: um teste que de fato trava continua reprovando, com a mensagem certa.
     */
    testTimeout: 15_000,
    // @arch-canvas/editor-adapter (transitively, @excalidraw/excalidraw) touches the
    // browser's CSS Font Loading API at module init — see
    // packages/editor-adapter/vitest.config.ts for the full rationale (same shim).
    server: {
      deps: {
        inline: [/@excalidraw\/excalidraw/, /roughjs/],
      },
    },
    // Coverage floor (CIQ-04): each number is the value measured when the floor
    // was introduced, locked as a ratchet. Lowering any of them requires editing
    // this file on purpose — no threshold is inherited implicitly.
    coverage: {
      enabled: true,
      provider: 'v8',
      thresholds: {
        lines: 56.54,
        functions: 72.5,
        branches: 85.52,
        statements: 56.54,
      },
    },
  },
});
