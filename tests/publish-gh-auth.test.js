import { describe, it, expect, vi, beforeEach } from 'vitest';

// Control what `gh auth status` returns
const spawnSync = vi.fn();
vi.mock('child_process', () => ({ spawnSync }));

const { requireGhAuth, publishBundle } = await import('../marketplace.js');

beforeEach(() => {
  spawnSync.mockReset();
});

// Route gh subcommands: `auth status` (the gate) and `issue create` (auto-submit)
function ghRouter({ authStatus = 0, issueStatus = 0, issueUrl = 'https://github.com/NeiP4n/promptgraph-registry/issues/42' } = {}) {
  return (cmd, argv) => {
    if (argv[0] === 'auth') return { status: authStatus };
    if (argv[0] === 'issue') return { status: issueStatus, stdout: issueUrl + '\n', stderr: '' };
    return { status: 0, stdout: '' };
  };
}

describe('requireGhAuth (publish gate)', () => {
  it('allows publishing when gh auth status exits 0', () => {
    spawnSync.mockReturnValue({ status: 0 });
    expect(requireGhAuth()).toEqual({ ok: true });
    expect(spawnSync).toHaveBeenCalledWith('gh', ['auth', 'status'], expect.anything());
  });

  it('blocks when signed out (non-zero exit)', () => {
    spawnSync.mockReturnValue({ status: 1 });
    const r = requireGhAuth();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/gh auth login/);
  });

  it('blocks when gh is not installed (ENOENT)', () => {
    spawnSync.mockReturnValue({ error: { code: 'ENOENT' } });
    const r = requireGhAuth();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/GitHub CLI/i);
  });

  it('blocks when spawnSync throws', () => {
    spawnSync.mockImplementation(() => { throw new Error('boom'); });
    const r = requireGhAuth();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/GitHub CLI/i);
  });
});

describe('publishBundle auto-submit (no confirmation)', () => {
  const validBundle = { id: 'test-bundle', name: 'Test Bundle', description: 'A bundle for testing auto-submit flow', skills: ['skill-one'] };

  it('auto-creates the registry issue and returns its url', async () => {
    spawnSync.mockImplementation(ghRouter());
    const r = await publishBundle(validBundle);
    expect(r.submitted).toBe(true);
    expect(r.issue_url).toMatch(/issues\/42/);
    // verify it actually called `gh issue create` against the registry — no manual step
    const issueCall = spawnSync.mock.calls.find(c => c[1]?.[0] === 'issue');
    expect(issueCall[1]).toContain('--repo');
    expect(issueCall[1]).toContain('NeiP4n/promptgraph-registry');
  });

  it('refuses to publish when not authenticated (no issue created)', async () => {
    spawnSync.mockImplementation(ghRouter({ authStatus: 1 }));
    const r = await publishBundle(validBundle);
    expect(r.error).toMatch(/gh auth login/);
    expect(spawnSync.mock.calls.some(c => c[1]?.[0] === 'issue')).toBe(false);
  });

  it('reports an error if auto-submit itself fails', async () => {
    spawnSync.mockImplementation(ghRouter({ issueStatus: 1 }));
    const r = await publishBundle(validBundle);
    expect(r.error).toMatch(/Auto-submit failed/);
  });

  it('rejects an invalid bundle before touching gh', async () => {
    spawnSync.mockImplementation(ghRouter());
    const r = await publishBundle({ id: 'x' });
    expect(r.error).toMatch(/validation/i);
    expect(spawnSync).not.toHaveBeenCalled();
  });
});
