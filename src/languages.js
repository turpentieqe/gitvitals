// Language detection by file extension / special filename.
// Colors are GitHub-inspired so the dashboard looks familiar.
// GitVitals never reads file contents — only names and sizes.

const EXT = {
  js: ['JavaScript', '#f1e05a'], mjs: ['JavaScript', '#f1e05a'], cjs: ['JavaScript', '#f1e05a'],
  jsx: ['JavaScript', '#f1e05a'], ts: ['TypeScript', '#3178c6'], tsx: ['TypeScript', '#3178c6'],
  mts: ['TypeScript', '#3178c6'], cts: ['TypeScript', '#3178c6'],
  py: ['Python', '#3572a5'], pyw: ['Python', '#3572a5'], pyi: ['Python', '#3572a5'],
  java: ['Java', '#b07219'], class: ['Java', '#b07219'], jar: ['Java', '#b07219'],
  go: ['Go', '#00add8'], rs: ['Rust', '#dea584'],
  c: ['C', '#555555'], h: ['C/C++', '#f34b7d'],
  cpp: ['C++', '#f34b7d'], cc: ['C++', '#f34b7d'], cxx: ['C++', '#f34b7d'], hpp: ['C++', '#f34b7d'],
  cs: ['C#', '#178600'], fs: ['F#', '#b845fc'], vb: ['Visual Basic', '#945db7'],
  rb: ['Ruby', '#701516'], erb: ['Ruby', '#701516'], gemspec: ['Ruby', '#701516'],
  php: ['PHP', '#4f5d95'], swift: ['Swift', '#f05138'], kt: ['Kotlin', '#a97bff'], kts: ['Kotlin', '#a97bff'],
  dart: ['Dart', '#00b4ab'], html: ['HTML', '#e34c26'], htm: ['HTML', '#e34c26'],
  css: ['CSS', '#563d7c'], scss: ['SCSS', '#c6538c'], sass: ['Sass', '#a53b70'], less: ['Less', '#1d365d'],
  sh: ['Shell', '#89e051'], bash: ['Shell', '#89e051'], zsh: ['Shell', '#89e051'], fish: ['Shell', '#89e051'],
  ps1: ['PowerShell', '#012456'], psm1: ['PowerShell', '#012456'], bat: ['Batch', '#c1f12e'], cmd: ['Batch', '#c1f12e'],
  json: ['JSON', '#cbcb41'], jsonc: ['JSON', '#cbcb41'], json5: ['JSON', '#cbcb41'],
  yaml: ['YAML', '#cb171e'], yml: ['YAML', '#cb171e'], toml: ['TOML', '#9c4221'], ini: ['INI', '#d1dbe0'],
  md: ['Markdown', '#083fa1'], markdown: ['Markdown', '#083fa1'], mdx: ['Markdown', '#083fa1'],
  rst: ['reStructuredText', '#141414'], txt: ['Text', '#8b8b8b'],
  sql: ['SQL', '#e38c00'], graphql: ['GraphQL', '#e10098'], gql: ['GraphQL', '#e10098'],
  vue: ['Vue', '#41b883'], svelte: ['Svelte', '#ff3e00'], astro: ['Astro', '#ff5a03'],
  lua: ['Lua', '#000080'], r: ['R', '#198ce7'], rmd: ['R', '#198ce7'],
  scala: ['Scala', '#c22d40'], sc: ['Scala', '#c22d40'],
  ex: ['Elixir', '#6e4a7e'], exs: ['Elixir', '#6e4a7e'], erl: ['Erlang', '#b83998'], hrl: ['Erlang', '#b83998'],
  hs: ['Haskell', '#5e5086'], lhs: ['Haskell', '#5e5086'],
  pl: ['Perl', '#0298c3'], pm: ['Perl', '#0298c3'],
  m: ['Objective-C', '#438eff'], mm: ['Objective-C++', '#438eff'],
  dockerfile: ['Dockerfile', '#384d54'], containerfile: ['Dockerfile', '#384d54'],
  xml: ['XML', '#0060ac'], xsl: ['XML', '#0060ac'], xsd: ['XML', '#0060ac'], svg: ['SVG', '#ff9900'],
  proto: ['Protobuf', '#749aab'], zig: ['Zig', '#ec915c'], nim: ['Nim', '#ffc200'],
  jl: ['Julia', '#a270ba'], clj: ['Clojure', '#db5855'], cljs: ['Clojure', '#db5855'], edn: ['Clojure', '#db5855'],
  ml: ['OCaml', '#ef7a08'], mli: ['OCaml', '#ef7a08'],
  asm: ['Assembly', '#6e4c13'], s: ['Assembly', '#6e4c13'], groovy: ['Groovy', '#4298b8'],
  gradle: ['Gradle', '#02303a'], tf: ['Terraform', '#5c4ee5'], tfvars: ['Terraform', '#5c4ee5'],
  sol: ['Solidity', '#aa6746'], vy: ['Vyper', '#2980b9'],
  ipynb: ['Jupyter', '#da5b0b'], csv: ['CSV', '#237346'], tsv: ['CSV', '#237346'],
  wasm: ['WebAssembly', '#654ff0'], wat: ['WebAssembly', '#654ff0'],
  lock: ['Lockfile', '#8b8b8b'], pdf: ['PDF', '#ec1c24'],
  png: ['Image', '#a97bff'], jpg: ['Image', '#a97bff'], jpeg: ['Image', '#a97bff'],
  gif: ['Image', '#a97bff'], webp: ['Image', '#a97bff'], ico: ['Image', '#a97bff'], bmp: ['Image', '#a97bff'],
  mp3: ['Audio', '#f0a30a'], wav: ['Audio', '#f0a30a'], mp4: ['Video', '#f0a30a'], mov: ['Video', '#f0a30a'],
  zip: ['Archive', '#8b8b8b'], tar: ['Archive', '#8b8b8b'], gz: ['Archive', '#8b8b8b'], rar: ['Archive', '#8b8b8b'],
  woff: ['Font', '#8b8b8b'], woff2: ['Font', '#8b8b8b'], ttf: ['Font', '#8b8b8b'], otf: ['Font', '#8b8b8b'],
};

const FILENAME = {
  dockerfile: ['Dockerfile', '#384d54'], containerfile: ['Dockerfile', '#384d54'],
  makefile: ['Makefile', '#427819'], gnumakefile: ['Makefile', '#427819'],
  gemfile: ['Ruby', '#701516'], rakefile: ['Ruby', '#701516'],
  cmakelists: ['CMake', '#da3434'], cargo: ['Rust', '#dea584'],
  license: ['License', '#8b8b8b'], copying: ['License', '#8b8b8b'],
  gitignore: ['Git', '#f05033'], gitattributes: ['Git', '#f05033'], gitmodules: ['Git', '#f05033'],
  editorconfig: ['Config', '#8b8b8b'], npmrc: ['Config', '#cb3837'], nvmrc: ['Config', '#8b8b8b'],
  'package.json': ['JSON', '#cbcb41'], 'package-lock.json': ['Lockfile', '#8b8b8b'],
  'tsconfig.json': ['JSON', '#3178c6'], 'go.mod': ['Go', '#00add8'], 'go.sum': ['Lockfile', '#8b8b8b'],
  'cargo.toml': ['Rust', '#dea584'], 'cargo.lock': ['Lockfile', '#8b8b8b'],
  'pyproject.toml': ['Python', '#3572a5'], 'requirements.txt': ['Python', '#3572a5'],
  'pipfile': ['Python', '#3572a5'], 'poetry.lock': ['Lockfile', '#8b8b8b'],
};

const OTHER = ['Other', '#6e7681'];

export function detectLanguage(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  const base = norm.split('/').pop().toLowerCase();
  if (FILENAME[base]) {
    const [name, color] = FILENAME[base];
    return { name, color, ext: base };
  }
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot + 1) : '';
  if (ext && EXT[ext]) {
    const [name, color] = EXT[ext];
    return { name, color, ext };
  }
  // Special case: .Dockerfile, Dockerfile.dev, etc.
  if (base.includes('dockerfile')) return { name: 'Dockerfile', color: '#384d54', ext: 'dockerfile' };
  return { name: OTHER[0], color: OTHER[1], ext: ext || base };
}

export function isBinaryExt(ext) {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'mp3', 'wav', 'mp4', 'mov',
    'zip', 'tar', 'gz', 'rar', 'woff', 'woff2', 'ttf', 'otf', 'pdf', 'jar', 'class', 'wasm'].includes(ext);
}