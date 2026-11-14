import test from 'node:test';
import assert from 'node:assert/strict';
import { platform } from 'node:os';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EncryptedTokenStore } from './encrypted-token-store.mjs';

test('tokens are authenticated-encrypted and atomically replaced without plaintext', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whoop-token-test-'));
  const filePath = join(directory, 'tokens.enc');
  const store = new EncryptedTokenStore({ filePath, key: Buffer.alloc(32, 7) });
  const first = { accessToken: 'fake-access-1', refreshToken: 'fake-refresh-1' };
  const second = { accessToken: 'fake-access-2', refreshToken: 'fake-refresh-2' };
  try {
    await store.write(first);
    assert.deepEqual(await store.read(), first);
    await store.write(second);
    assert.deepEqual(await store.read(), second);
    const encrypted = await readFile(filePath, 'utf8');
    assert.equal(encrypted.includes('fake-access-2'), false);
    if (platform() !== 'win32') assert.equal((await stat(filePath)).mode & 0o777, 0o600);
    await store.clear();
    assert.equal(await store.read(), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});