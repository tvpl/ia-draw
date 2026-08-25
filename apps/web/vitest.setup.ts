import { configure } from '@testing-library/dom';

/**
 * GATE-04 (F11/R20, reforçado em R23): `findBy*` espera 1000 ms por padrão, e essa é a margem
 * que decide se `make ci` sai 0 ou 1 nesta máquina. Cem arquivos de teste com jsdom em 4 CPUs
 * fazem uma asserção assíncrona qualquer estourar o limite, e o arquivo que perde a corrida
 * muda a cada execução — o sintoma que sessões anteriores registraram como "flake conhecido".
 *
 * Cinco segundos é folga para a contenção sem ser tolerância a defeito: um elemento que nunca
 * aparece continua reprovando, apenas cinco segundos depois. A alternativa — reduzir os workers
 * do vitest — deixaria a suíte inteira mais lenta para proteger meia dúzia de asserções.
 */
configure({ asyncUtilTimeout: 5_000 });

// See packages/test-fixtures/vitest.setup.ts for the full rationale: @excalidraw/excalidraw
// touches the browser's CSS Font Loading API at module init, which jsdom doesn't implement.
// This is a headless-test shim only; it ships in no production code.
if (typeof globalThis.FontFace === 'undefined') {
  class FontFaceShim {
    family: string;
    source: string;
    status = 'unloaded';
    [key: string]: unknown;

    constructor(family: string, source: string, descriptors?: Record<string, unknown>) {
      this.family = family;
      this.source = source;
      Object.assign(this, descriptors);
    }

    load(): Promise<this> {
      this.status = 'loaded';
      return Promise.resolve(this);
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: shimming a browser global not in the Node lib
  (globalThis as any).FontFace = FontFaceShim;
}
