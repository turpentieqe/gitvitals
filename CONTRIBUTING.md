# Contributing to GitVitals

Thanks for helping make GitVitals better!

## Setup

GitVitals has **zero runtime dependencies**. You only need Node.js ≥ 18 and Git.

```bash
git clone <your-fork>
cd gitvitals
npm test          # run the smoke tests
npm run demo      # generate a sample repo + report to eyeball the dashboard
```

## Project layout

```
bin/gitvitals.js        CLI entry point + argument parsing
src/git.js              Git data extraction (git log --numstat, ls-files + stat)
src/languages.js        Language detection by extension/filename
src/analyze.js          Metrics engine (health, bus factor, hotspots, activity…)
src/render.js           Injects analysis JSON into the HTML template
src/template/           The self-contained dashboard (inline CSS/JS/SVG, no CDN)
src/terminal.js         Pretty terminal summary
scripts/make-demo.mjs   Builds a realistic demo repository
test/smoke.mjs          End-to-end smoke tests
```

## Guidelines

- **Keep it dependency-free.** If a feature seems to need a package, think twice.
- **Keep the report self-contained.** No external fonts, scripts, styles, or network calls in the template.
- **Preserve privacy.** Never read source file contents; never export author emails; escape user-controlled strings injected into HTML.
- **Handle tiny/empty repos gracefully** — no commits, no files, one contributor.
- Run `npm test` before opening a PR. Add a test for new metrics.

## Good first issues

Look for the `good first issue` label. Ideas: new language colors, a panel export, configurable health weights.

## Commits & PRs

- Write clear commit messages (imperative mood: "Add punch-card tooltip").
- One logical change per PR.
- Be kind. See the spirit of the Contributor Covenant.

By contributing, you agree your contributions are licensed under the MIT License.