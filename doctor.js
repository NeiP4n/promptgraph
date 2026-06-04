import { getDb } from './db.js';

export function runDoctor() {
  const db = getDb();
  const report = {};

  // orphaned chunks (skill_id not in skills)
  const orphanChunks = db.prepare(`
    DELETE FROM chunks WHERE skill_id NOT IN (SELECT id FROM skills)
  `).run();
  report.orphanChunks = orphanChunks.changes;

  // orphaned ratings
  const orphanRatings = db.prepare(`
    DELETE FROM ratings WHERE skill_id NOT IN (SELECT id FROM skills)
  `).run();
  report.orphanRatings = orphanRatings.changes;

  // orphaned edges where from_skill no longer exists
  const orphanFromEdges = db.prepare(`
    DELETE FROM edges WHERE from_skill NOT IN (SELECT id FROM skills)
  `).run();
  report.orphanFromEdges = orphanFromEdges.changes;

  // dangling edges where to_skill is a bare name that never resolved to a real skill
  // (keep edges that point to real ids OR bare names that match a skill name)
  const danglingEdges = db.prepare(`
    DELETE FROM edges
    WHERE to_skill NOT IN (SELECT id FROM skills)
      AND to_skill NOT IN (SELECT name FROM skills)
  `).run();
  report.danglingEdges = danglingEdges.changes;

  // duplicate skills by path (should not happen, but check)
  const dupPaths = db.prepare(`
    SELECT path, COUNT(*) as c FROM skills GROUP BY path HAVING c > 1
  `).all();
  report.duplicatePaths = dupPaths.length;

  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');

  report.totalSkills = db.prepare('SELECT COUNT(*) as c FROM skills').get().c;
  report.totalChunks = db.prepare('SELECT COUNT(*) as c FROM chunks').get().c;
  report.totalEdges = db.prepare('SELECT COUNT(*) as c FROM edges').get().c;

  return report;
}
