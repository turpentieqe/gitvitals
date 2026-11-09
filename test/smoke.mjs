import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isGitRepo, getRepoMeta, getCommits, getTrackedFiles } from '../src/git.js';
import { analyze } from '../src/analyze.js';
import { renderReport } from '../src/render.js';

function git(cwd, args, env) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true });
}
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'gitvitals-test-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}
function commit(dir, msg, author, ts) {
  const date = `${ts} +0000`;
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', msg, `--author=${author}`], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
}

const dirs = [];
try {
  // --- Repo with history ---
  const dir = makeRepo(); dirs.push(dir);
  assert.ok(isGitRepo(dir), 'should detect git repo');
  const now = Math.floor(Date.now() / 1000);
  writeFileSync(join(dir, 'index.ts'), 'export const x = 1;\n'.repeat(40));
  writeFileSync(join(dir, 'main.py'), 'print("hi")\n'.repeat(30));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'app.js'), 'console.log(1)\n'.repeat(20));
  commit(dir, 'Initial', 'Alice <alice@example.com>', now - 20 * 86400);
  writeFileSync(join(dir, 'index.ts'), 'export const x = 2;\n'.repeat(50));
  commit(dir, 'Update x', 'Bob <bob@example.com>', now - 5 * 86400);
  writeFileSync(join(dir, 'src', 'app.js'), 'console.log(2)\n'.repeat(25));
  commit(dir, 'Update app', 'Alice <alice@example.com>', now - 86400);

  const meta = getRepoMeta(dir);
  const commits = getCommits(dir);
  const files = getTrackedFiles(dir);
  const data = analyze(commits, files, meta);

  assert.equal(data.meta.totalCommits, 3, '3 commits');
  assert.equal(data.contributors.total, 2, '2 contributors');
  assert.equal(data.meta.totalFiles, 3, '3 tracked files');
  assert.ok(data.meta.totalBytes > 0, 'has bytes');
  assert.ok(typeof data.health.score === 'number' && data.health.score >= 0 && data.health.score <= 100, 'health score range');
  assert.ok(data.health.factors.length === 5, '5 health factors');
  assert.ok(data.activity.calendar.length > 300, 'calendar ~1 year');
  assert.ok(Array.isArray(data.activity.byHour) && data.activity.byHour.length === 24, 'byHour 24');
  assert.ok(Array.isArray(data.activity.byDow) && data.activity.byDow.length === 7, 'byDow 7');
  assert.ok(data.velocity.series.length >= 1, 'velocity series');
  assert.ok(data.contributors.busFactor >= 1, 'bus factor >=1');
  assert.ok(Array.isArray(data.languages) && data.languages.length >= 2, 'languages detected');
  assert.ok(data.hotspots.length >= 1, 'hotspots found');
  assert.ok(data.treemap.length >= 1, 'treemap populated');

  const html = renderReport(data);
  assert.ok(typeof html === 'string' && html.length > 2000, 'html rendered');
  assert.ok(!/__GIT[A-Z]+_DATA__/.test(html), 'placeholder replaced');
  assert.ok(html.includes('"totalCommits"'), 'data injected');
  assert.ok(!html.includes('<script src="http'), 'no external scripts (offline)');

  // --- Empty repo ---
  const empty = makeRepo(); dirs.push(empty);
  const emeta = getRepoMeta(empty);
  const edata = analyze(getCommits(empty), getTrackedFiles(empty), emeta);
  assert.equal(edata.meta.totalCommits, 0, 'empty: 0 commits');
  assert.equal(edata.health.score, 0, 'empty: health 0');
  assert.equal(edata.contributors.busFactor, 0, 'empty: bus factor 0');
  const ehtml = renderReport(edata);
  assert.ok(ehtml.length > 2000 && !/__GIT[A-Z]+_DATA__/.test(ehtml), 'empty repo renders');

  process.stdout.write('\n  ✔ All smoke tests passed (history + empty repo, render + offline check)\n\n');
} finally {
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
}