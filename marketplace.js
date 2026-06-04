import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { getDb } from './db.js';
import { validateSkill } from './validator.js';

const REGISTRY_URL = 'https://raw.githubusercontent.com/NeiP4n/promptgraph-registry/main/registry.json';
const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills-store', 'marketplace');

export async function browseMarketplace(topK = 20) {
  try {
    const res = await fetch(REGISTRY_URL);
    if (!res.ok) return { error: `Registry returned ${res.status}. Check https://github.com/NeiP4n/promptgraph-registry` };
    const registry = await res.json();
    if (!Array.isArray(registry.skills)) return { error: 'Invalid registry format' };
    return registry.skills
      .sort((a, b) => (b.stars || 0) - (a.stars || 0))
      .slice(0, topK);
  } catch (e) {
    return { error: `Registry unavailable: ${e.message}` };
  }
}

export async function installSkill(skillId) {
  try {
    const res = await fetch(REGISTRY_URL);
    if (!res.ok) return { error: `Registry returned ${res.status}` };
    const registry = await res.json();
    const skill = registry.skills?.find(s => s.id === skillId);
    if (!skill) return { error: `Skill "${skillId}" not found in registry` };
    if (!skill.raw_url) return { error: `Skill "${skillId}" has no download URL` };

    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    const dest = path.join(SKILLS_DIR, `${skillId}.md`);

    const content = await fetch(skill.raw_url);
    if (!content.ok) return { error: `Failed to download skill: ${content.status}` };
    const text = await content.text();
    fs.writeFileSync(dest, text);

    return { success: true, path: dest, name: skill.name };
  } catch (e) {
    return { error: e.message };
  }
}

export async function publishSkill(filePath) {
  if (!fs.existsSync(filePath)) return { error: `File not found: ${filePath}` };

  // validate before publishing — block junk and malicious skills
  const validation = validateSkill(filePath);
  if (!validation.ok) {
    return { error: 'Validation failed', issues: validation.errors, warnings: validation.warnings };
  }

  const name = path.basename(filePath, '.md');

  try {
    const result = spawnSync(
      'gh',
      ['gist', 'create', filePath, '--desc', `PromptGraph skill: ${name}`, '--public'],
      { encoding: 'utf8' }
    );
    if (result.status !== 0) {
      return { error: result.stderr?.trim() || 'gh CLI error. Run: gh auth login' };
    }
    return {
      success: true,
      url: result.stdout.trim(),
      message: `Published! Submit to registry: https://github.com/NeiP4n/promptgraph-registry/issues/new`,
    };
  } catch {
    return { error: 'gh CLI not found. Install from: https://cli.github.com' };
  }
}

export function getTopRated(topK = 10) {
  const db = getDb();
  return db.prepare(`
    SELECT s.id, s.name, s.description, s.source,
           r.uses, r.success, r.fail,
           CASE WHEN (r.success + r.fail) > 0
                THEN ROUND(CAST(r.success AS FLOAT) / (r.success + r.fail), 2)
                ELSE NULL END as rating
    FROM skills s
    LEFT JOIN ratings r ON s.id = r.skill_id
    WHERE (r.success + r.fail) >= 3
    ORDER BY rating DESC, r.uses DESC
    LIMIT ?
  `).all(topK);
}

export function recordUse(skillId) {
  const db = getDb();
  db.prepare(`
    INSERT INTO ratings (skill_id, uses, success, fail)
    VALUES (?, 1, 0, 0)
    ON CONFLICT(skill_id) DO UPDATE SET uses = uses + 1
  `).run(skillId);
}

export function recordSuccess(skillId) {
  const db = getDb();
  db.prepare(`
    INSERT INTO ratings (skill_id, uses, success, fail)
    VALUES (?, 0, 1, 0)
    ON CONFLICT(skill_id) DO UPDATE SET success = success + 1
  `).run(skillId);
}

export function recordFail(skillId) {
  const db = getDb();
  db.prepare(`
    INSERT INTO ratings (skill_id, uses, success, fail)
    VALUES (?, 0, 0, 1)
    ON CONFLICT(skill_id) DO UPDATE SET fail = fail + 1
  `).run(skillId);
}
