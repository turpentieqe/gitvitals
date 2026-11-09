import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { detectLanguage } from './languages.js';

const MAX_BUFFER = 256 * 1024 * 1024;

export function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    timeout: 180000,
  });
}

export function isGitRepo(cwd) {
  try {
    return runGit(['rev-parse', '--is-inside-work-tree'], cwd).trim() === 'true';
  } catch {
    return false;
  }
}

export function getRepoMeta(cwd) {
  const toplevel = runGit(['rev-parse', '--show-toplevel'], cwd).trim();
  let branch = 'HEAD';
  try {
    branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim();
  } catch { /* empty repo */ }
  let remoteUrl = '';
  try {
    remoteUrl = runGit(['config', '--get', 'remote.origin.url'], cwd).trim();
  } catch { /* no remote */ }
  return {
    toplevel,
    name: basename(toplevel) || 'repository',
    branch,
    remoteUrl,
  };
}

// Parse `git log --numstat` into structured commits.
// Record separator \x1e starts each commit; unit separator \x1f divides fields.
export function getCommits(cwd, { since, branch } = {}) {
  const args = [
    'log', '--no-merges', '--numstat', '--date=unix',
    '--pretty=format:%x1e%H%x1f%an%x1f%ae%x1f%at%x1f%s',
  ];
  if (since) args.push(`--since=${since}`);
  args.push(branch || 'HEAD');

  let out;
  try {
    out = runGit(args, cwd);
  } catch (err) {
    // Empty repository (no commits yet).
    const msg = String(err.stderr || err.message);
    if (/does not have any commits yet|bad default revision|unknown revision/i.test(msg)) {
      return [];
    }
    throw err;
  }

  const commits = [];
  for (const chunk of out.split('\x1e')) {
    if (!chunk.trim()) continue;
    const lines = chunk.split('\n');
    const header = lines[0].split('\x1f');
    if (header.length < 5) continue;
    const [hash, author, email, ts, ...subjParts] = header;
    const time = parseInt(ts, 10);
    if (!Number.isFinite(time)) continue;
    const subject = subjParts.join('\x1f').slice(0, 160);

    const files = [];
    let additions = 0;
    let deletions = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      let path = parts.slice(2).join('\t');
      // Normalize rename notation "old => new" / "{a => b}/file".
      path = normalizeRename(path);
      files.push({ path, added, deleted });
      additions += added;
      deletions += deleted;
    }

    commits.push({
      hash, author: author || 'Unknown',
      email: (email || '').toLowerCase(),
      time, subject, files, additions, deletions,
    });
  }
  // git log is newest-first; reverse to chronological for streak/series math.
  commits.reverse();
  return commits;
}

function normalizeRename(path) {
  // "dir/{old => new}/file" or "old => new"
  if (!path.includes('=>')) return path;
  const brace = path.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (brace) return `${brace[1]}${brace[3]}${brace[4]}`.replace(/\/\//g, '/');
  const simple = path.match(/^(.*) => (.*)$/);
  if (simple) return simple[2];
  return path;
}

// Tracked files with on-disk sizes. Never reads file contents.
export function getTrackedFiles(toplevel) {
  let out;
  try {
    out = runGit(['ls-files', '-z', '--full-name'], toplevel);
  } catch {
    return [];
  }
  const paths = out.split('\0').filter(Boolean);
  const files = [];
  for (const path of paths) {
    let bytes = 0;
    try {
      bytes = statSync(join(toplevel, path)).size;
    } catch { /* sparse checkout / missing on disk */ }
    const { name, color, ext } = detectLanguage(path);
    files.push({ path, bytes, lang: name, color, ext });
  }
  return files;
}