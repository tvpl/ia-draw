import { describe, expect, it } from 'vitest';
import { validateProviderBaseUrl } from './ssrf.js';

describe('validateProviderBaseUrl (T41, AIC-03)', () => {
  it('rejects the cloud metadata address without an allowlist', async () => {
    const result = await validateProviderBaseUrl('http://169.254.169.254/latest/meta-data');
    expect(result.allowed).toBe(false);
  });

  it('rejects a private 10.0.0.0/8 address without an allowlist', async () => {
    const result = await validateProviderBaseUrl('http://10.0.0.5/v1');
    expect(result.allowed).toBe(false);
  });

  it('accepts a private 10.0.0.0/8 address WITH an explicit allowlist containing the host', async () => {
    const result = await validateProviderBaseUrl('http://10.0.0.5/v1', ['10.0.0.5']);
    expect(result.allowed).toBe(true);
  });

  it('rejects a private 192.168.0.0/16 address without an allowlist', async () => {
    const result = await validateProviderBaseUrl('http://192.168.1.1/v1');
    expect(result.allowed).toBe(false);
  });

  it('accepts a private 192.168.0.0/16 address WITH an explicit allowlist containing the host', async () => {
    const result = await validateProviderBaseUrl('http://192.168.1.1/v1', ['192.168.1.1']);
    expect(result.allowed).toBe(true);
  });

  it('rejects a private 172.16.0.0/12 address without an allowlist', async () => {
    const result = await validateProviderBaseUrl('http://172.20.5.5/v1');
    expect(result.allowed).toBe(false);
  });

  it('rejects the IPv4 loopback address', async () => {
    const result = await validateProviderBaseUrl('http://127.0.0.1/v1');
    expect(result.allowed).toBe(false);
  });

  it('rejects a hostname that resolves to loopback via DNS (not just a literal IP)', async () => {
    const result = await validateProviderBaseUrl('http://localhost/v1');
    expect(result.allowed).toBe(false);
  });

  it('accepts a common public baseUrl', async () => {
    const result = await validateProviderBaseUrl('https://api.openai.com/v1');
    expect(result.allowed).toBe(true);
  });

  it('rejects an unsupported protocol', async () => {
    const result = await validateProviderBaseUrl('ftp://10.0.0.5/v1');
    expect(result.allowed).toBe(false);
  });

  it('rejects a malformed URL', async () => {
    const result = await validateProviderBaseUrl('not a url at all');
    expect(result.allowed).toBe(false);
  });

  it('an allowlist entry for a different host does not accidentally allow a blocked one', async () => {
    const result = await validateProviderBaseUrl('http://169.254.169.254/', [
      'some-other-host.example',
    ]);
    expect(result.allowed).toBe(false);
  });
});
