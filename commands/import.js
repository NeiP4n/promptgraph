import { colors, banner, success, error, info, section, table } from '../cli.js';

export default async function handler(args, bin) {
  const { importFromGitHub } = await import('../github-import.js');
  await importFromGitHub(args[1]);
  process.exit(0);
}
