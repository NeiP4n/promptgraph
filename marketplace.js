import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { getDb } from './db.js';

const REGISTRY_URL = 'https://raw.githubusercontent.com/NeiP4n/promptgraph-registry/main/registry.json';
const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills-store', 'marketplace');

export async function browseMarketplace(topK = 20) {
  try {
    const res = await fetch(REGISTRY_URL);
    const registry = await res.json();
    return registry.skills
      .sort((a, b) => (b.stars || 0) - (a.stars || 0))
      .slice(0, topK);
  } catch {
    return { error: 'Registry unavailable. Check https://github.com/NeiP4n/promptgraph-registry' };
  }
}

export async function installSkill(skillId) {
  try {
    const res = await fetch(REGISTRY_URL);
    const registry = await res.json();
    const skill = registry.skills.find(s => s.id === skillId);
    if (!skill) return { error: `Skill "${skillId}" not found in registry` };

    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    const dest = path.join(SKILLS_DIR, `${skillId}.md`);

    const content = await fetch(skill.raw_url);
    const text = await content.text();
    fs.writeFileSync(dest, text);

    return { success: true, path: dest, name: skill.name };
  } catch (e) {
    return { error: e.message };
  }
}

export async function publishSkill(filePath) {
  if (!fs.existsSync(filePath)) return { error: `File not found: ${filePath}` };

  const content = fs.readFileSync(filePath, 'utf8');
  const name = path.basename(filePath, '.md');

  try {
    const result = execSync(
      `gh gist create "${filePath}" --desc "PromptGraph skill: ${name}" --public`,
      { encoding: 'utf8' }
    ).trim();
    return {
      success: true,
      url: result,
      message: `Published! Submit to registry: https://github.com/NeiP4n/promptgraph-registry/issues/new`,
    };
  } catch {
    return { error: 'gh CLI not found or not authenticated. Run: gh auth login' };
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
    WHERE r.uses > 0
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
