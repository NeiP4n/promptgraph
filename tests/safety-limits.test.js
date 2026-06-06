import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { MAX_DOWNLOAD_SIZE, MAX_FILE_COUNT, MAX_REPO_SIZE, RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_MS, BATCH_SIZE } from '../config.js';
import { RateLimiter } from '../src/utils/rate-limiter.js';
import { sanitizeExternalContent, validateSkill } from '../validator.js';

const tmp = path.join(os.tmpdir(), 'pg-safety-test');
beforeAll(() => fs.mkdirSync(tmp, { recursive: true }));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function write(name, content) {
  const fp = path.join(tmp, name);
  fs.writeFileSync(fp, content);
  return fp;
}

const validBody = 'x'.repeat(250);

describe('config limits', () => {
  it('MAX_DOWNLOAD_SIZE is 50 MB', () => {
    expect(MAX_DOWNLOAD_SIZE).toBe(50 * 1024 * 1024);
  });

  it('MAX_FILE_COUNT is 50000', () => {
    expect(MAX_FILE_COUNT).toBe(50000);
  });

  it('MAX_REPO_SIZE is 500 MB', () => {
    expect(MAX_REPO_SIZE).toBe(500 * 1024 * 1024);
  });

  it('RATE_LIMIT_REQUESTS is 30', () => {
    expect(RATE_LIMIT_REQUESTS).toBe(30);
  });

  it('RATE_LIMIT_WINDOW_MS is 60000', () => {
    expect(RATE_LIMIT_WINDOW_MS).toBe(60000);
  });

  it('BATCH_SIZE is 100', () => {
    expect(BATCH_SIZE).toBe(100);
  });
});

describe('RateLimiter', () => {
  it('allows requests within limit', () => {
    const rl = new RateLimiter({ maxRequests: 3, windowMs: 60000 });
    expect(rl.tryAcquire()).toBe(true);
    expect(rl.tryAcquire()).toBe(true);
    expect(rl.tryAcquire()).toBe(true);
  });

  it('blocks requests after max', () => {
    const rl = new RateLimiter({ maxRequests: 2, windowMs: 60000 });
    expect(rl.tryAcquire()).toBe(true);
    expect(rl.tryAcquire()).toBe(true);
    expect(rl.tryAcquire()).toBe(false);
  });

  it('allows requests after window expires', async () => {
    const rl = new RateLimiter({ maxRequests: 1, windowMs: 50 });
    expect(rl.tryAcquire()).toBe(true);
    expect(rl.tryAcquire()).toBe(false);
    await new Promise(r => setTimeout(r, 60));
    expect(rl.tryAcquire()).toBe(true);
  });

  it('acquire() resolves when a slot frees up', async () => {
    const rl = new RateLimiter({ maxRequests: 1, windowMs: 50 });
    expect(rl.tryAcquire()).toBe(true);
    const start = Date.now();
    await rl.acquire();
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

describe('sanitizeExternalContent', () => {
  it('strips null bytes from content', () => {
    const input = 'hello\x00world\x00test';
    const result = sanitizeExternalContent(input);
    expect(result).toBe('helloworldtest');
    expect(result.includes('\0')).toBe(false);
  });

  it('truncates content exceeding MAX_DOWNLOAD_SIZE', () => {
    const size = MAX_DOWNLOAD_SIZE;
    const oversized = 'a'.repeat(size + 100);
    const result = sanitizeExternalContent(oversized);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(size);
  });

  it('preserves content under limit', () => {
    const input = 'normal content without null bytes';
    const result = sanitizeExternalContent(input);
    expect(result).toBe(input);
  });

  it('handles empty content', () => {
    expect(sanitizeExternalContent('')).toBe('');
  });
});

describe('validateSkill — extension whitelist', () => {
  it('accepts .md files', () => {
    const fp = write('test.md', `---
name: ext-test
description: extension whitelist test skill
---
${validBody}`);
    expect(validateSkill(fp).ok).toBe(true);
  });

  it('rejects .exe files', () => {
    const fp = write('test.exe', `---
name: bad-ext
description: rejected extension test
---
${validBody}`);
    const r = validateSkill(fp);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /extension/i.test(e))).toBe(true);
  });

  it('rejects .bat files', () => {
    const fp = write('script.bat', `---
name: bat-ext
description: batch file extension test
---
${validBody}`);
    const r = validateSkill(fp);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /extension/i.test(e))).toBe(true);
  });

  it('rejects .dll files', () => {
    const fp = write('lib.dll', `---
name: dll-ext
description: dll extension test
---
${validBody}`);
    const r = validateSkill(fp);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /extension/i.test(e))).toBe(true);
  });

  it('rejects .exe when content is valid skill format', () => {
    const fp = write('skill.exe', `---
name: fake-exe
description: exe with valid frontmatter test
---
${validBody}`);
    const r = validateSkill(fp);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /extension/i.test(e))).toBe(true);
  });
});

describe('validateSkill — null byte detection', () => {
  it('rejects content with null bytes', () => {
    const fp = write('nullskill.md', '---\nname: null-skill\ndescription: contains null bytes test\n---\n' + validBody + '\x00');
    const r = validateSkill(fp);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /null byte/i.test(e))).toBe(true);
  });

  it('rejects content with embedded null bytes', () => {
    const buf = Buffer.from('---\nname: bin-skill\ndescription: binary content test\n---\n' + validBody.replace(/x/g, 'y'));
    const withNull = Buffer.concat([buf, Buffer.from([0, 0, 0])]);
    const fp = path.join(tmp, 'binary.md');
    fs.writeFileSync(fp, withNull);
    const r = validateSkill(fp);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /null byte/i.test(e))).toBe(true);
  });
});

describe('sanitizeExternalContent — combined edge cases', () => {
  it('strips multiple embedded null bytes', () => {
    const input = '\x00a\x00b\x00c\x00';
    expect(sanitizeExternalContent(input)).toBe('abc');
  });

  it('handles content exactly at size limit', () => {
    const exact = 'a'.repeat(MAX_DOWNLOAD_SIZE);
    const result = sanitizeExternalContent(exact);
    expect(result.length).toBe(exact.length);
  });

  it('handles content with only null bytes', () => {
    expect(sanitizeExternalContent('\x00\x00\x00')).toBe('');
  });
});
