#!/usr/bin/env node
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { isGitRepo, getRepoMeta, getCommits, getTrackedFiles } from '../src/git.js';
import { analyze } from '../src/analyze.js';
import { renderReport } from '../src/render.js';
import { printSummary } from '../src/terminal.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version;

const HELP = `
GitVitals v${VERSION} — your repository's health report in one command.

Usage
  gitvitals [path] [options]

Arguments
  path                 Path to a Git repository (default: current directory)

Options
  -o, --out <file>     Output HTML file (default: gitvitals-report.html)
  --open               Open the report in your browser after generating
  --no-open            Do not open the browser (default in CI / non-TTY)
  --json               Print the raw analysis as JSON instead of HTML
  --since <date>       Only analyze commits since a date (e.g. 2024-01-01, "6 months ago")
  --branch <name>      Analyze a specific branch (default: HEAD)
  --no-color           Disable colored terminal output
  -h, --help           Show this help
  -v, --version        Show version

Examples
  gitvitals
  gitvitals ~/code/my-app --open
  gitvitals . --out reports/my-app.html --since "1 year ago"
  gitvitals . --json > vitals.json

Privacy: GitVitals never reads your source code. It uses only Git metadata
and file sizes. Everything runs locally; the report is a single offline file.
`;

function parseArgs(argv) {
  const opts = { path: '.', out: null, open: null, json: false, since: null, branch: null, color: true, help: false, version: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': opts.help = true; break;
      case '-v': case '--version': opts.version = true; break;
      case '--json': opts.json = true; break;
      case '--open': opts.open = true; break;
      case '--no-open': opts.open = false; break;
      case '--no-color': opts.color = false; break;
      case '-o': case '--out': opts.out = argv[++i]; break;
      case '--since': opts.since = argv[++i]; break;
      case '--branch': opts.branch = argv[++i]; break;
      default:
        if (a.startsWith('--out=')) opts.out = a.slice(6);
        else if (a.startsWith('--since=')) opts.since = a.slice(8);
        else if (a.startsWith('--branch=')) opts.branch = a.slice(9);
        else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
        else positional.push(a);
    }
  }
  if (positional.length) opts.path = positional[0];
  if (positional.length > 1) throw new Error('Only one repository path is supported.');
  return opts;
}

function openBrowser(file) {
  const url = 'file://' + (file.startsWith('/') ? file : '/' + file.replace(/\\/g, '/'));
  const platform = process.platform;
  let cmd, args;
  if (platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', file]; }
  else if (platform === 'darwin') { cmd = 'open'; args = [file]; }
  else { cmd = 'xdg-open'; args = [file]; }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { process.stdout.write(HELP + '\n'); return; }
  if (opts.version) { process.stdout.write(VERSION + '\n'); return; }
  if (!opts.color) process.env.NO_COLOR = '1';

  const inputPath = resolve(process.cwd(), opts.path);
  if (!isGitRepo(inputPath)) {
    process.stderr.write(`\n  ✖ Not a Git repository: ${inputPath}\n  Run GitVitals inside a repo, or pass a path: gitvitals <path>\n\n`);
    process.exit(1);
  }

  const repo = getRepoMeta(inputPath);
  const cwd = repo.toplevel;
  const commits = getCommits(cwd, { since: opts.since, branch: opts.branch });
  const files = getTrackedFiles(cwd);
  const data = analyze(commits, files, repo);

  if (opts.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  const outPath = opts.out
    ? (isAbsolute(opts.out) ? opts.out : resolve(process.cwd(), opts.out))
    : join(process.cwd(), 'gitvitals-report.html');

  const html = renderReport(data);
  writeFileSync(outPath, html, 'utf8');

  printSummary(data, outPath);

  const shouldOpen = opts.open != null ? opts.open : (Boolean(process.stdout.isTTY) && !process.env.CI);
  if (shouldOpen) openBrowser(outPath);
}

try {
  main();
} catch (err) {
  process.stderr.write(`\n  ✖ GitVitals error: ${err.message}\n\n`);
  if (process.env.DEBUG) process.stderr.write(String(err.stack) + '\n');
  process.exit(1);
}