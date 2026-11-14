import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export class EncryptedTokenStore {
  constructor({ filePath, key }) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('A 32-byte token encryption key is required');
    this.filePath = filePath;
    this.key = key;
  }

  async read() {
    let envelope;
    try {
      envelope = JSON.parse(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error('Encrypted token file could not be read');
    }
    if (envelope.version !== 1) throw new Error('Encrypted token file version is unsupported');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.nonce, 'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]);
      return JSON.parse(plaintext.toString('utf8'));
    } catch {
      throw new Error('Encrypted token file authentication failed');
    }
  }

  async write(tokens) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens)), cipher.final()]);
    const envelope = JSON.stringify({
      version: 1,
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    });
    const directory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let handle;
    try {
      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(envelope, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporaryPath, this.filePath);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await rm(temporaryPath, { force: true });
    }
  }

  async clear() {
    await rm(this.filePath, { force: true });
  }
}