#!/usr/bin/env node
'use strict';
// protocolo-serafim-um:doctor-ignore-file
/**
 * Protocolo Serafim UM — doctor
 *
 * Faz as perguntas que quem programa com IA ainda não sabe fazer: escaneia
 * o projeto, dá uma nota de 0 a 100 e, pra cada problema, explica por que
 * importa, como corrigir e entrega uma PERGUNTA PRONTA pra colar na IA.
 *
 * Sem dependências, sem rede, sem enviar nada pra lugar nenhum. Nunca
 * imprime o valor de um segredo encontrado — só o tipo e onde está.
 *
 * Uso:
 *   npx protocolo-serafim-um-setup doctor           relatório no terminal
 *   npx protocolo-serafim-um-setup doctor --json    saída em JSON
 *   npx protocolo-serafim-um-setup doctor --ci      sai com código 1 se houver crítico/alto
 *   npx protocolo-serafim-um-setup doctor --no-write  não grava os arquivos de relatório
 *
 * Grava (a não ser com --no-write):
 *   <pasta de memória>/DIAGNOSTICO.md  — lido pela IA no início de cada sessão
 *   src/qa/doctor-report.json          — lido pelo Watchdog (aba Diagnóstico), se instalado
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DOCTOR_VERSION = 1;
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.vercel', '.turbo',
  '.cache', 'vendor', '.svelte-kit', '.nuxt', '.output', 'dist-paid', '.expo', 'android', 'ios',
]);
const SCAN_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.json', '.yml', '.yaml', '.toml', '.html', '.sql']);
const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte']);
const MAX_BYTES = 1024 * 1024;
const MAX_FILES = 12000;
const IGNORE_MARKER = 'protocolo-serafim-um:doctor-ignore-file';

const WEIGHT = { critical: 25, high: 12, medium: 6, low: 2 };
const ORDER = ['critical', 'high', 'medium', 'low'];
const LABEL = { critical: 'CRÍTICO', high: 'ALTO', medium: 'MÉDIO', low: 'BAIXO' };

const SECRET_PATTERNS = [
  { re: /sk_live_[0-9a-zA-Z]{16,}/, kind: 'chave secreta LIVE do Stripe', sev: 'critical' },
  { re: /sk_test_[0-9a-zA-Z]{16,}/, kind: 'chave secreta de teste do Stripe', sev: 'high' },
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}/, kind: 'chave da API da Anthropic', sev: 'critical' },
  // \b + exigir maiúscula, minúscula e dígito: sem isso, "risk-management-dashboard-..." vira "chave"
  { re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/, kind: 'chave de API de IA (formato OpenAI)', sev: 'critical', mixed: true },
  { re: /AKIA[0-9A-Z]{16}/, kind: 'chave de acesso da AWS', sev: 'critical' },
  { re: /gh[pousr]_[A-Za-z0-9]{36,}/, kind: 'token do GitHub', sev: 'critical' },
  { re: /github_pat_[A-Za-z0-9_]{40,}/, kind: 'token do GitHub', sev: 'critical' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, kind: 'chave privada', sev: 'critical' },
  { re: /service[_-]?role[_-]?(?:key)?["']?\s*[:=]\s*["']eyJ[A-Za-z0-9_-]{10,}/i, kind: 'service_role do Supabase', sev: 'critical' },
];

const PUBLIC_VAR_RE = /\b((?:NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC|NUXT_PUBLIC|PUBLIC)_[A-Z0-9_]+)/g;
const SENSITIVE_NAME_RE = /(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|OPENAI|ANTHROPIC|CLAUDE|GROQ|DEEPSEEK|GEMINI|MISTRAL|COHERE|OPENROUTER|BLACKBOX|ELEVENLABS|RESEND|SENDGRID|TWILIO|WEBHOOK)/;

const MODEL_RE = /["'`]((?:gpt-[0-9][\w.-]*)|(?:claude-[\w.-]+)|(?:gemini-[\w.-]+)|(?:llama-?[0-9][\w.-]*)|(?:deepseek-[\w.-]+)|(?:mixtral-[\w.-]+)|(?:qwen[\w.-]*)|(?:mistral-[\w.-]+))["'`]/gi;
// Modelos que os provedores já retiraram ou descontinuaram. Lista conservadora
// de propósito — melhor deixar passar um do que acusar um modelo que funciona.
const DEPRECATED_MODELS = new Set([
  'text-davinci-003', 'gpt-4-vision-preview', 'gpt-4-32k', 'gpt-3.5-turbo-0301',
  'claude-2', 'claude-2.0', 'claude-2.1', 'claude-instant-1', 'claude-instant-1.2',
  'gemini-pro', 'gemini-1.0-pro', 'gemini-1.5-pro', 'gemini-1.5-flash',
  'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-70b-8192', 'llama3-8b-8192',
  'mixtral-8x7b-32768', 'deepseek-chat',
]);

// ── utilitários ──────────────────────────────────────────────

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

function readJsonLoose(p) {
  const raw = readText(p);
  if (raw === null) return null;
  const cleaned = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(cleaned); } catch { return null; }
}

function git(root, args) {
  return execSync(`git ${args}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).toString();
}

function walk(root) {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < MAX_FILES) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(childRel);
      } else if (e.isFile()) {
        out.push(childRel);
        if (out.length >= MAX_FILES) break;
      }
    }
  }
  return out;
}

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// Valores de exemplo publicados em documentação (ex: a chave AWS oficial
// "AKIAIOSFODNN7EXAMPLE") não são segredo — acusar isso ensina a ignorar o alerta.
function isRealSecret(value, pattern) {
  if (/example|xxxx|your[_-]?key|placeholder|dummy|fake/i.test(value)) return false;
  if (pattern.mixed && !(/[0-9]/.test(value) && /[A-Z]/.test(value) && /[a-z]/.test(value))) return false;
  return true;
}

// Bundle compilado (nome com hash) é cópia do código-fonte: escanear duplica
// achados e aponta pro arquivo errado.
const isBuiltAsset = (rel) => /\.min\.(js|css)$/.test(rel) || /(^|\/)assets\/[^/]+-[A-Za-z0-9_-]{8}\.(m?js|css)$/.test(rel);

// Código que o navegador carrega. Scripts, Edge Functions, servidores e
// configs de build rodam fora do navegador: ler uma variável ali não a expõe.
const isBrowserSide = (rel) =>
  !/^(scripts|supabase|server|backend|api|functions|e2e|tests?|\.github|public_html|dist)\//.test(rel) &&
  !/(^|\/)(vite|vitest|next|tailwind|eslint|postcss|playwright|webpack|rollup)\.config\.[cm]?[jt]s$/.test(rel);

const isTestPath = (rel) => /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(rel);
const isEnvFile = (rel) => /(^|\/)\.env(\.[\w.-]+)?$/.test(rel);
const isEnvTemplate = (rel) => /\.env\.(example|sample|template|dist)$/.test(rel);

// ── detecção de stack (reusada pelo setup.js) ───────────────

function detectStack(root) {
  const pkg = readJsonLoose(path.join(root, 'package.json'));
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
  const reactMajor = parseInt(String(deps.react || '').replace(/[^\d.]/g, '').split('.')[0], 10) || null;
  const stack = {
    pkg,
    hasNext: !!deps.next,
    hasVite: !!deps.vite,
    hasReact: !!deps.react,
    reactMajor,
    hasExpress: !!deps.express,
    hasSupabase: !!deps['@supabase/supabase-js'] || exists(path.join(root, 'supabase', 'config.toml')),
    hasStripe: !!(deps.stripe || deps['@stripe/stripe-js']),
    hasResend: !!deps.resend,
    hasTypeScript: !!deps.typescript || exists(path.join(root, 'tsconfig.json')),
    hasTailwind: !!deps.tailwindcss,
  };
  const labels = [];
  if (stack.hasNext) labels.push('Next.js');
  else if (stack.hasVite && stack.hasReact) labels.push('React + Vite');
  else if (stack.hasReact) labels.push('React');
  if (stack.hasExpress) labels.push('Express');
  if (stack.hasTypeScript) labels.push('TypeScript');
  if (stack.hasSupabase) labels.push('Supabase');
  if (stack.hasStripe) labels.push('Stripe');
  if (stack.hasTailwind) labels.push('Tailwind');
  stack.label = labels.join(' + ');

  let deploy = '';
  if (exists(path.join(root, 'vercel.json')) || exists(path.join(root, '.vercel'))) deploy = 'Vercel';
  else if (exists(path.join(root, 'netlify.toml'))) deploy = 'Netlify';
  else if (exists(path.join(root, 'railway.json')) || exists(path.join(root, 'railway.toml'))) deploy = 'Railway';
  stack.deploy = deploy;
  return stack;
}

function findMemoryDirs(root) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter(e => e.isDirectory() && e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
    .map(e => e.name)
    .filter(name => exists(path.join(root, name, 'ESTADO_ATUAL.md')));
}

// ── o diagnóstico ────────────────────────────────────────────

function runDoctor(root = process.cwd()) {
  const findings = [];
  const add = (f) => findings.push({ files: [], where: [], ...f });

  const stack = detectStack(root);
  const files = walk(root);
  const isGit = exists(path.join(root, '.git'));

  let gitFiles = null;
  if (isGit) {
    try { gitFiles = git(root, 'ls-files').split('\n').filter(Boolean); } catch { gitFiles = null; }
  }

  // ── Git e arquivos de ambiente ──
  if (!isGit && stack.pkg) {
    add({
      id: 'no-git', severity: 'medium',
      title: 'Projeto sem controle de versão (git)',
      why: 'Sem git não existe "desfazer": se a IA quebrar algo, não há como voltar pro estado que funcionava.',
      fix: 'Rode `git init` e faça um primeiro commit agora, com o projeto funcionando.',
      prompt: 'Inicialize o git neste projeto, crie um .gitignore adequado à stack (incluindo .env e node_modules) e faça o primeiro commit. Me explique em uma frase como eu volto para este ponto se algo quebrar.',
    });
  }

  if (gitFiles) {
    const committedEnv = gitFiles.filter(f => isEnvFile(f) && !isEnvTemplate(f));
    if (committedEnv.length) {
      add({
        id: 'env-committed', severity: 'critical',
        title: 'Arquivo .env está no git',
        files: committedEnv, where: committedEnv,
        why: 'Tudo que já foi commitado fica no histórico mesmo depois de apagado. Se o repositório for (ou um dia ficar) público, as chaves estão expostas — robôs varrem o GitHub atrás disso em minutos.',
        fix: '`git rm --cached` nos arquivos, .env no .gitignore, e TROQUE todas as chaves que estavam nele — considere todas vazadas.',
        prompt: `Meu arquivo ${committedEnv[0]} está commitado no git. Tire ele do controle de versão sem apagar o arquivo local (git rm --cached), garanta que .env* esteja no .gitignore (exceto .env.example), e me liste quais chaves estavam nele para eu trocar uma por uma nos painéis dos provedores.`,
      });
    }
    const nodeModulesCommitted = gitFiles.some(f => f.startsWith('node_modules/'));
    if (nodeModulesCommitted) {
      add({
        id: 'node-modules-committed', severity: 'high',
        title: 'node_modules está commitado no git',
        files: ['node_modules/'], where: ['node_modules/'],
        why: 'Deixa o repositório gigante, lento e cheio de código de terceiros que não é seu — e esconde suas mudanças reais no meio de milhares de arquivos.',
        fix: 'Adicione node_modules ao .gitignore e rode `git rm -r --cached node_modules`.',
        prompt: 'O node_modules está commitado no meu git. Remova do controle de versão sem apagar localmente, adicione ao .gitignore e confirme que o projeto continua rodando com npm install.',
      });
    }
  }

  const localEnvFiles = ['.env', '.env.local', '.env.production', '.env.development'].filter(f => exists(path.join(root, f)));
  const unignoredEnv = localEnvFiles.filter(f => {
    if (gitFiles && gitFiles.includes(f)) return false;
    if (isGit) {
      try { git(root, `check-ignore -q "${f}"`); return false; } catch { return true; }
    }
    const gi = readText(path.join(root, '.gitignore')) || '';
    return !/^\s*\.env/m.test(gi);
  });
  if (unignoredEnv.length) {
    add({
      id: 'env-not-ignored', severity: 'high',
      title: '.env não está protegido pelo .gitignore',
      files: unignoredEnv, where: unignoredEnv,
      why: 'Ainda não foi commitado — mas o próximo `git add .` leva suas chaves pro repositório.',
      fix: 'Adicione `.env*` e `!.env.example` ao .gitignore.',
      prompt: 'Meu .env não está no .gitignore. Corrija o .gitignore para ignorar todos os .env* exceto o .env.example, e confirme com git check-ignore que funcionou.',
    });
  }

  // ── leitura dos arquivos ──
  const secretHits = new Map();       // kind -> {sev, where[]}
  const publicUsed = new Map();       // var com prefixo público LIDA em código que vai pro navegador -> where[]
  const publicDefined = new Map();    // var com prefixo público só DEFINIDA (.env) -> where[]
  const browserAI = [];
  const serviceRoleFrontend = [];
  const modelIds = new Map();         // id -> Set(files)
  const deprecatedHits = new Map();   // id -> where[]
  const anyByFile = [];
  let anyTotal = 0;
  let consoleTotal = 0;
  const bigFiles = [];
  const innerHtml = [];
  const evalHits = [];
  let hasTests = false;
  let hasHealth = false;
  const migrations = [];

  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (isTestPath(rel)) hasTests = true;
    if (/(^|\/)health(\/|\.|$)/i.test(rel) && CODE_EXT.has(ext)) hasHealth = true;
    if (/^supabase\/migrations\/.+\.sql$/.test(rel)) migrations.push(rel);

    if (isEnvFile(rel)) {
      const txt = readText(path.join(root, rel)) || '';
      for (const m of txt.matchAll(/^\s*([A-Z0-9_]+)\s*=/gm)) {
        const name = m[1];
        if (/^(NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC|NUXT_PUBLIC|PUBLIC)_/.test(name) && SENSITIVE_NAME_RE.test(name)) {
          if (!publicDefined.has(name)) publicDefined.set(name, []);
          publicDefined.get(name).push(`${rel}:${lineOf(txt, m.index)}`);
        }
      }
      continue;
    }

    if (!SCAN_EXT.has(ext) || rel.endsWith('package-lock.json') || isBuiltAsset(rel)) continue;
    let size = 0;
    try { size = fs.statSync(path.join(root, rel)).size; } catch { continue; }
    if (size > MAX_BYTES) continue;
    const text = readText(path.join(root, rel));
    if (text === null || text.includes(IGNORE_MARKER)) continue;

    // segredos — nunca guardamos o valor, só tipo e posição
    let anthropicHit = false;
    for (const p of SECRET_PATTERNS) {
      if (anthropicHit && p.kind.includes('OpenAI')) continue; // sk-ant- também casa o formato OpenAI
      const m = p.re.exec(text);
      if (m && isRealSecret(m[0], p)) {
        if (!secretHits.has(p.kind)) secretHits.set(p.kind, { sev: p.sev, where: [] });
        secretHits.get(p.kind).where.push(`${rel}:${lineOf(text, m.index)}`);
        if (p.kind.includes('Anthropic')) anthropicHit = true;
      }
    }

    if (!CODE_EXT.has(ext)) continue;
    const isTest = isTestPath(rel);

    // Só conta como "exposta" quando um código que o NAVEGADOR carrega lê a
    // variável. Script de build, Edge Function e config não vão pro bundle —
    // acusar isso como crítico é alarme falso, e alarme falso ensina a
    // ignorar o doctor (achado ao rodar o doctor no próprio SERAFIM13).
    if (isBrowserSide(rel) && !isTest) {
      for (const m of text.matchAll(PUBLIC_VAR_RE)) {
        if (SENSITIVE_NAME_RE.test(m[1])) {
          if (!publicUsed.has(m[1])) publicUsed.set(m[1], []);
          const w = publicUsed.get(m[1]);
          if (w.length < 5) w.push(`${rel}:${lineOf(text, m.index)}`);
        }
      }
    }

    const dab = /dangerouslyAllowBrowser\s*:\s*true/.exec(text);
    if (dab) browserAI.push(`${rel}:${lineOf(text, dab.index)}`);

    const sr = /(process\.env|import\.meta\.env)\.[A-Z0-9_]*SERVICE_ROLE/.exec(text);
    if (sr) {
      const frontendVite = stack.hasVite && !stack.hasNext && rel.startsWith('src/');
      const clientNext = stack.hasNext && /^\s*['"]use client['"]/m.test(text);
      if (frontendVite || clientNext) serviceRoleFrontend.push(`${rel}:${lineOf(text, sr.index)}`);
    }

    if (!isTest) {
      for (const m of text.matchAll(MODEL_RE)) {
        const id = m[1].toLowerCase();
        if (!/\d/.test(id)) continue;
        if (!modelIds.has(id)) modelIds.set(id, new Set());
        modelIds.get(id).add(rel);
        if (DEPRECATED_MODELS.has(id)) {
          if (!deprecatedHits.has(id)) deprecatedHits.set(id, []);
          const w = deprecatedHits.get(id);
          if (w.length < 5) w.push(`${rel}:${lineOf(text, m.index)}`);
        }
      }
    }

    if ((ext === '.ts' || ext === '.tsx') && !rel.endsWith('.d.ts')) {
      const n = (text.match(/(:\s*any\b)|(\bas\s+any\b)|(<any>)/g) || []).length;
      if (n) { anyTotal += n; anyByFile.push([rel, n]); }
    }

    if (!isTest && /^(src|app|pages|components|lib)\//.test(rel)) {
      consoleTotal += (text.match(/console\.log\(/g) || []).length;
    }

    const lines = text.split('\n').length;
    if (lines > 600 && !isTest) bigFiles.push([rel, lines]);

    const ih = /dangerouslySetInnerHTML/.exec(text);
    if (ih) innerHtml.push(`${rel}:${lineOf(text, ih.index)}`);

    const ev = /\beval\(|new Function\(/.exec(text);
    if (ev && !isTest) evalHits.push(`${rel}:${lineOf(text, ev.index)}`);
  }

  for (const [kind, { sev, where }] of secretHits) {
    add({
      id: `secret:${kind}`, severity: sev,
      title: `Segredo no código: ${kind}`,
      files: where.map(w => w.split(':')[0]), where: where.slice(0, 5),
      why: 'Chave dentro do código vai pro git, pro build e, se for frontend, pro navegador de qualquer visitante. Quem copiar usa seus créditos, seus dados e sua conta.',
      fix: 'Mova pro .env (sem prefixo público), leia via variável de ambiente no backend, e TROQUE a chave no painel do provedor — trate como vazada.',
      prompt: `Encontrei uma ${kind} escrita diretamente no código (${where[0]}). Mova para uma variável de ambiente lida só no backend, remova do código, e me diga onde eu gero uma chave nova para invalidar a antiga.`,
    });
  }

  if (publicUsed.size) {
    const names = [...publicUsed.keys()];
    const where = names.flatMap(n => publicUsed.get(n)).slice(0, 6);
    add({
      id: 'public-prefix-secret', severity: 'critical',
      title: `Chave secreta exposta ao navegador: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}`,
      files: where.map(w => w.split(':')[0]), where,
      why: 'Prefixos como NEXT_PUBLIC_ e VITE_ significam "copie este valor pro JavaScript que o navegador baixa". Qualquer visitante abre o DevTools e leva a chave — inclusive de IA, que é gasta no SEU cartão.',
      fix: 'Tire o prefixo público, leia a chave só no backend (API route / Edge Function) e o frontend chama o backend.',
      prompt: `As variáveis ${names.join(', ')} têm prefixo público e são lidas por código que vai pro navegador. Crie um endpoint no backend que use essas chaves sem prefixo público, faça o frontend chamar esse endpoint, e remova o prefixo. Depois me diga quais chaves eu preciso trocar porque já ficaram expostas.`,
    });
  }
  const dormant = [...publicDefined.keys()].filter(n => !publicUsed.has(n));
  if (dormant.length) {
    const where = dormant.flatMap(n => publicDefined.get(n)).slice(0, 6);
    add({
      id: 'public-prefix-dormant', severity: 'medium',
      title: `Chave secreta com prefixo público (ainda não usada no código): ${dormant.slice(0, 3).join(', ')}${dormant.length > 3 ? '…' : ''}`,
      files: where.map(w => w.split(':')[0]), where,
      why: 'Hoje nenhum código do navegador lê essa variável, então ela não está no bundle. Mas o prefixo público é uma armadilha armada: no dia em que alguém (ou a IA) usar a variável, ou fizer um `console.log(import.meta.env)`, a chave vai pro navegador de todo mundo.',
      fix: 'Renomeie sem o prefixo público e use só no backend. Se nunca vai usar, apague.',
      prompt: `As variáveis ${dormant.join(', ')} têm prefixo público mas ninguém as usa. Remova o prefixo (ou apague a variável) no .env, no .env.example e nos workflows de CI, e confirme que nada no frontend depende delas.`,
    });
  }

  if (browserAI.length) {
    add({
      id: 'ai-sdk-in-browser', severity: 'critical',
      title: 'SDK de IA chamado direto do navegador (dangerouslyAllowBrowser)',
      files: browserAI.map(w => w.split(':')[0]), where: browserAI.slice(0, 5),
      why: 'O próprio nome da opção avisa: a chave de IA fica visível pra qualquer visitante, que pode gastar seus créditos sem limite.',
      fix: 'Chame a IA a partir do backend (API route, Edge Function) com a chave em variável de ambiente sem prefixo público.',
      prompt: 'Meu app chama a API de IA direto do navegador com dangerouslyAllowBrowser: true. Mova essa chamada para um endpoint de backend, com a chave lida de variável de ambiente, limite de uso por usuário, e faça o frontend chamar esse endpoint.',
    });
  }

  if (serviceRoleFrontend.length) {
    add({
      id: 'service-role-frontend', severity: 'critical',
      title: 'service_role do Supabase usada em código de frontend',
      files: serviceRoleFrontend.map(w => w.split(':')[0]), where: serviceRoleFrontend.slice(0, 5),
      why: 'A service_role ignora todas as regras de segurança (RLS) do banco. No frontend, qualquer visitante lê, altera e apaga dados de todos os usuários.',
      fix: 'No frontend use só a anon key. Operações que precisam de service_role vão pra uma Edge Function / API route.',
      prompt: 'Estou usando a SERVICE_ROLE do Supabase em código que roda no navegador. Mova toda operação que precisa dela para uma Edge Function ou API route, use só a anon key no frontend, e confirme que as tabelas afetadas têm RLS com policies corretas.',
    });
  }

  // ── Supabase: tabelas sem RLS nas migrations ──
  if (migrations.length) {
    const created = new Set();
    const rlsOn = new Set();
    let uidPerRow = 0;
    for (const rel of migrations.sort()) {
      const sql = (readText(path.join(root, rel)) || '')
        .replace(/--.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .toLowerCase();
      for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/g)) {
        if (!m[1] || m[1] === 'public') created.add(m[2]);
      }
      for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s+enable\s+row\s+level\s+security/g)) {
        if (!m[1] || m[1] === 'public') rlsOn.add(m[2]);
      }
      for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/g)) {
        if (!m[1] || m[1] === 'public') { created.delete(m[2]); rlsOn.delete(m[2]); }
      }
      const totalUid = (sql.match(/auth\.uid\(\)/g) || []).length;
      const wrapped = (sql.match(/select\s+auth\.uid\(\)/g) || []).length;
      uidPerRow += Math.max(0, totalUid - wrapped);
    }
    const noRls = [...created].filter(t => !rlsOn.has(t));
    if (noRls.length) {
      add({
        id: 'supabase-no-rls', severity: 'high',
        title: `${noRls.length} tabela(s) criadas sem RLS nas migrations`,
        files: ['supabase/migrations/'], where: noRls.slice(0, 8),
        why: 'Sem Row Level Security, qualquer pessoa com a anon key (que é pública) lê e altera a tabela inteira — inclusive dados de outros usuários.',
        fix: 'Para cada tabela: `alter table x enable row level security;` + policies por usuário usando `(select auth.uid())`. Confirme no banco real com a query de RLS do protocolo.',
        prompt: `Pelas migrations, estas tabelas não têm RLS ativada: ${noRls.slice(0, 8).join(', ')}. Crie uma migration nova (com UP e DOWN) que ative RLS em cada uma e crie policies para que cada usuário só acesse os próprios dados, usando (select auth.uid()). Antes, me pergunte se alguma delas deveria ser pública de propósito.`,
      });
    }
    if (uidPerRow > 0) {
      add({
        id: 'rls-uid-per-row', severity: 'medium',
        title: `${uidPerRow} uso(s) de auth.uid() sem (select ...) nas policies`,
        files: ['supabase/migrations/'], where: ['supabase/migrations/'],
        why: 'auth.uid() puro é reavaliado em CADA linha da consulta. Em tabela grande, vira lentidão e timeout.',
        fix: 'Troque `auth.uid()` por `(select auth.uid())` nas policies.',
        prompt: 'Minhas policies de RLS usam auth.uid() direto. Crie uma migration que recrie essas policies usando (select auth.uid()), sem mudar a regra de acesso, com script DOWN.',
      });
    }
  }

  // ── IA: modelos ──
  for (const [id, where] of deprecatedHits) {
    add({
      id: `model-deprecated:${id}`, severity: 'high',
      title: `Modelo de IA descontinuado: ${id}`,
      files: where.map(w => w.split(':')[0]), where,
      why: 'O provedor já retirou ou anunciou a retirada deste modelo. Quando sai do ar, toda chamada passa a falhar — geralmente sem aviso no app.',
      fix: 'Troque pelo sucessor indicado na documentação do provedor e mova o nome do modelo para uma variável de ambiente.',
      prompt: `Meu código usa o modelo ${id}, que foi descontinuado. Verifique na documentação oficial do provedor qual é o substituto atual, troque, e mova o nome do modelo para uma variável de ambiente para a próxima troca não exigir mudar código.`,
    });
  }
  const repeated = [...modelIds].filter(([, set]) => set.size >= 3);
  if (repeated.length) {
    const [id, set] = repeated.sort((a, b) => b[1].size - a[1].size)[0];
    add({
      id: 'model-hardcoded', severity: 'medium',
      title: `Nome de modelo de IA repetido em ${set.size} arquivos (${id})`,
      files: [...set], where: [...set].slice(0, 5),
      why: 'Quando o provedor descontinua o modelo, todos esses arquivos quebram juntos — e é preciso caçar e trocar um por um.',
      fix: 'Centralize o nome do modelo numa variável de ambiente ou num único arquivo de config.',
      prompt: `O modelo ${id} está escrito em ${set.size} arquivos diferentes. Centralize em uma variável de ambiente (com um valor padrão em um único arquivo de configuração) e faça todos os arquivos lerem dali.`,
    });
  }

  // ── contexto da IA / memória ──
  const aiContext = ['CLAUDE.md', 'AGENTS.md', '.cursorrules', '.windsurfrules', '.github/copilot-instructions.md', '.cursor/rules']
    .filter(f => exists(path.join(root, f)));
  if (!aiContext.length && stack.pkg) {
    add({
      id: 'no-ai-context', severity: 'medium',
      title: 'A IA não tem arquivo de contexto do projeto',
      why: 'Sem CLAUDE.md/AGENTS.md, cada sessão começa do zero: a IA não sabe a stack, as regras nem o que já foi decidido — e repete erros já corrigidos.',
      fix: 'Rode `npx protocolo-serafim-um-setup` neste projeto.',
      prompt: 'Leia a estrutura deste projeto e me diga qual stack, padrões e riscos você identifica — vou usar isso para criar o arquivo de contexto da IA com o Protocolo Serafim UM.',
    });
  }
  const memoryDirs = findMemoryDirs(root);
  const bigContext = [];
  for (const f of [...aiContext.filter(f => !f.endsWith('rules')), ...memoryDirs.map(d => `${d}/ESTADO_ATUAL.md`)]) {
    try {
      const s = fs.statSync(path.join(root, f));
      if (s.isFile() && s.size > 40 * 1024) bigContext.push([f, s.size]);
    } catch { /* arquivo some entre leituras: ignora */ }
  }
  if (bigContext.length) {
    const worst = bigContext.sort((a, b) => b[1] - a[1])[0];
    add({
      id: 'context-too-big', severity: worst[1] > 200 * 1024 ? 'high' : 'medium',
      title: `Memória da IA grande demais: ${worst[0]} (${Math.round(worst[1] / 1024)}KB)`,
      files: bigContext.map(b => b[0]), where: bigContext.map(b => `${b[0]} (${Math.round(b[1] / 1024)}KB)`),
      why: 'Acima de dezenas de KB a IA não lê o arquivo inteiro — trunca ou ignora, e perde justamente o contexto que a memória existia pra guardar.',
      fix: 'Mantenha ESTADO_ATUAL.md com o estado da semana (< 100 linhas) e mova o histórico para HISTORICO_DE_DECISOES.md ou um arquivo de arquivo morto.',
      prompt: `O arquivo ${worst[0]} tem ${Math.round(worst[1] / 1024)}KB. Resuma o estado atual real do projeto em menos de 100 linhas, mova o histórico antigo para um arquivo de arquivo (ex: ARQUIVO_ESTADO_${new Date().getFullYear()}.md) sem perder nada, e me mostre o resumo antes de substituir.`,
    });
  }

  // ── qualidade ──
  const tsconfigs = ['tsconfig.json', 'tsconfig.app.json'].map(f => readJsonLoose(path.join(root, f))).filter(Boolean);
  const withOptions = tsconfigs.filter(t => t.compilerOptions);
  if (withOptions.length && !withOptions.some(t => t.compilerOptions.strict === true)) {
    add({
      id: 'ts-not-strict', severity: 'medium',
      title: 'TypeScript sem modo strict',
      files: ['tsconfig.json'], where: ['tsconfig.json'],
      why: 'Sem strict, o TypeScript deixa passar null/undefined e tipos errados — os mesmos erros que viram tela branca em produção.',
      fix: 'Ative `"strict": true` no compilerOptions e corrija os erros aos poucos.',
      prompt: 'Ative "strict": true no tsconfig, rode o typecheck e corrija os erros que aparecerem, começando pelos arquivos de autenticação e pagamento. Não use "any" para silenciar erro.',
    });
  }
  if (anyTotal > 0) {
    const top = anyByFile.sort((a, b) => b[1] - a[1]).slice(0, 3);
    add({
      id: 'ts-any', severity: anyTotal >= 10 ? 'medium' : 'low',
      title: `${anyTotal} uso(s) de "any" no TypeScript`,
      files: anyByFile.map(a => a[0]), where: top.map(([f, n]) => `${f} (${n})`),
      why: '"any" desliga a checagem de tipos naquele ponto. É onde os bugs de "Cannot read property of undefined" se escondem.',
      fix: 'Troque por tipos reais; para dados externos, valide com Zod e use o tipo inferido.',
      prompt: `Substitua os usos de "any" em ${top.map(t => t[0]).join(', ')} por tipos reais. Para dados que vêm de API ou formulário, crie um schema Zod e use o tipo inferido dele.`,
    });
  }
  if (!hasTests && stack.pkg) {
    add({
      id: 'no-tests', severity: 'medium',
      title: 'Nenhum teste automatizado',
      why: 'Sem teste, a única forma de saber que algo quebrou é um usuário reclamar. Toda mudança que a IA faz é um tiro no escuro.',
      fix: 'Comece com 3 testes: login, o fluxo principal do produto e o pagamento (se houver).',
      prompt: 'Configure testes automatizados neste projeto (Vitest se for Vite/React, ou o padrão da stack) e escreva os 3 testes mais importantes: login, o fluxo principal do produto e o pagamento se existir. Me explique como rodar.',
    });
  }
  const workflowsDir = path.join(root, '.github', 'workflows');
  const hasCI = (exists(workflowsDir) && fs.readdirSync(workflowsDir).some(f => /\.ya?ml$/.test(f))) || exists(path.join(root, '.gitlab-ci.yml'));
  if (!hasCI && stack.pkg) {
    add({
      id: 'no-ci', severity: 'medium',
      title: 'Sem CI (checagem automática a cada push)',
      why: 'Sem CI, código que não compila pode ir pro ar — nada impede.',
      fix: 'Rode `npx protocolo-serafim-um-setup` (gera o workflow) ou crie um que rode typecheck, lint e testes.',
      prompt: 'Crie um workflow de GitHub Actions que, a cada push e pull request, instale as dependências, rode typecheck, lint, testes e build — e falhe se qualquer um falhar.',
    });
  }
  if (!hasHealth && (stack.hasNext || stack.hasExpress || stack.hasSupabase)) {
    add({
      id: 'no-health', severity: 'low',
      title: 'Sem endpoint de health check',
      why: 'Sem ele, você descobre que o app caiu quando um cliente reclama — não antes.',
      fix: 'Rode `npx protocolo-serafim-um-setup` (gera o health certo pra stack) e monitore com UptimeRobot.',
      prompt: 'Crie um endpoint /api/health que só verifique a conexão com o banco e responda em menos de 200ms (200 se ok, 503 se não), sem lógica de negócio e sem autenticação.',
    });
  }
  if (bigFiles.length) {
    const top = bigFiles.sort((a, b) => b[1] - a[1]).slice(0, 3);
    add({
      id: 'big-files', severity: 'low',
      title: `${bigFiles.length} arquivo(s) com mais de 600 linhas`,
      files: bigFiles.map(b => b[0]), where: top.map(([f, n]) => `${f} (${n} linhas)`),
      why: 'Arquivo gigante é onde a IA mais erra: ela perde o fio, duplica lógica e quebra uma parte enquanto mexe em outra.',
      fix: 'Separe em componentes/hooks menores por responsabilidade.',
      prompt: `O arquivo ${top[0][0]} tem ${top[0][1]} linhas. Proponha como dividi-lo em partes menores por responsabilidade (UI, lógica, acesso a dados), sem mudar o comportamento, e me mostre o plano antes de executar.`,
    });
  }
  if (consoleTotal > 20) {
    add({
      id: 'console-log', severity: 'low',
      title: `${consoleTotal} console.log no código do app`,
      why: 'Logs soltos poluem o console e às vezes imprimem dados de usuário ou tokens no navegador de qualquer pessoa.',
      fix: 'Use um logger central e remova logs de depuração antes do deploy.',
      prompt: 'Revise os console.log do código do app: remova os de depuração e troque os que importam por um logger central que não imprima dados sensíveis em produção.',
    });
  }
  if (innerHtml.length) {
    add({
      id: 'inner-html', severity: 'medium',
      title: `dangerouslySetInnerHTML em ${innerHtml.length} arquivo(s)`,
      files: innerHtml.map(w => w.split(':')[0]), where: innerHtml.slice(0, 5),
      why: 'Se o conteúdo vier de usuário ou de fora, é porta aberta pra XSS — script de terceiro rodando com a sessão do seu usuário.',
      fix: 'Confirme que o HTML é 100% controlado por você, ou sanitize com DOMPurify.',
      prompt: `Revise os usos de dangerouslySetInnerHTML (${innerHtml[0]}). Para cada um, me diga se o conteúdo pode vir de usuário ou de fonte externa; se puder, sanitize com DOMPurify ou troque por renderização segura.`,
    });
  }
  if (evalHits.length) {
    add({
      id: 'eval', severity: 'medium',
      title: 'Uso de eval / new Function',
      files: evalHits.map(w => w.split(':')[0]), where: evalHits.slice(0, 5),
      why: 'Executa texto como código. Se qualquer parte do texto vier de fora, é execução remota de código.',
      fix: 'Substitua por lógica explícita (JSON.parse, mapa de funções, etc.).',
      prompt: `Encontrei eval/new Function em ${evalHits[0]}. Substitua por uma alternativa que não execute texto como código e me explique o risco que existia.`,
    });
  }
  if (stack.pkg && !['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'].some(f => exists(path.join(root, f)))) {
    add({
      id: 'no-lockfile', severity: 'low',
      title: 'Sem lockfile de dependências',
      why: 'Sem lockfile, cada instalação pode puxar versões diferentes — "funciona na minha máquina" e quebra no deploy.',
      fix: 'Rode `npm install` e commite o package-lock.json.',
      prompt: 'Gere o lockfile de dependências deste projeto, commite, e configure o CI para usar npm ci.',
    });
  }

  // ── nota e mapa ──
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;
  const penalty = findings.reduce((s, f) => s + WEIGHT[f.severity], 0);
  const score = Math.max(0, 100 - penalty);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  findings.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));

  const atlas = buildAtlas(root, files, findings);
  const healthPath = stack.hasNext ? '/api/health' : null;

  return {
    doctorVersion: DOCTOR_VERSION,
    generatedAt: new Date().toISOString(),
    score, grade, counts,
    stack: stack.label,
    healthPath,
    findings: findings.map(({ files: _f, ...rest }) => rest),
    atlas,
  };
}

// Mapa real da arquitetura pro Watchdog: cada pasta de código, quantos
// arquivos tem e o pior achado do doctor dentro dela. Nada inventado.
function buildAtlas(root, files, findings) {
  const roots = ['src', 'app', 'pages', 'components', 'lib', 'server', 'api', 'supabase/functions'];
  const atlas = [];
  for (const base of roots) {
    const inBase = files.filter(f => f.startsWith(`${base}/`) && CODE_EXT.has(path.extname(f).toLowerCase()));
    if (!inBase.length) continue;
    const groups = new Map();
    for (const f of inBase) {
      const rest = f.slice(base.length + 1);
      const key = rest.includes('/') ? rest.split('/')[0] : '(raiz)';
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    const items = [...groups].map(([name, count]) => {
      const prefix = name === '(raiz)' ? `${base}/` : `${base}/${name}/`;
      const hits = findings.filter(fd => (fd.files || []).some(p => p.startsWith(prefix)));
      const worst = ORDER.find(sev => hits.some(h => h.severity === sev)) || null;
      return { name, files: count, findings: hits.length, worst };
    }).sort((a, b) => (ORDER.indexOf(a.worst ?? 'none') - ORDER.indexOf(b.worst ?? 'none')) || b.files - a.files);
    atlas.push({ system: base, items: items.slice(0, 20) });
  }
  return atlas;
}

// ── saída ────────────────────────────────────────────────────

function colors(enabled) {
  const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return { red: wrap('31'), yellow: wrap('33'), green: wrap('32'), cyan: wrap('36'), dim: wrap('2'), bold: wrap('1'), magenta: wrap('35') };
}

function printReport(report, { compact = false } = {}) {
  const c = colors(process.stdout.isTTY && !process.env.NO_COLOR);
  const sevColor = { critical: c.red, high: c.magenta, medium: c.yellow, low: c.dim };
  const gradeColor = report.score >= 75 ? c.green : report.score >= 50 ? c.yellow : c.red;
  const out = [];
  out.push('');
  out.push(`  ${c.bold('PROTOCOLO SERAFIM UM — doctor')}  ${c.dim(report.stack || 'stack não detectada')}`);
  out.push(`  Nota: ${gradeColor(c.bold(`${report.score}/100 (${report.grade})`))}   ` +
    `${c.red(`${report.counts.critical} crítico`)} · ${c.magenta(`${report.counts.high} alto`)} · ` +
    `${c.yellow(`${report.counts.medium} médio`)} · ${c.dim(`${report.counts.low} baixo`)}`);
  out.push('');
  if (!report.findings.length) {
    out.push(`  ${c.green('Nenhum problema encontrado nas checagens automáticas.')}`);
  }
  const list = compact ? report.findings.slice(0, 3) : report.findings;
  for (const f of list) {
    out.push(`  ${sevColor[f.severity](`[${LABEL[f.severity]}]`)} ${c.bold(f.title)}`);
    if (f.where.length) out.push(`    ${c.dim('onde:')} ${f.where.slice(0, 3).join(', ')}${f.where.length > 3 ? ` ${c.dim(`(+${f.where.length - 3})`)}` : ''}`);
    if (!compact) {
      out.push(`    ${c.dim('por quê:')} ${f.why}`);
      out.push(`    ${c.dim('corrigir:')} ${f.fix}`);
      out.push(`    ${c.cyan('pergunte à sua IA:')} "${f.prompt}"`);
    }
    out.push('');
  }
  if (compact && report.findings.length > 3) {
    out.push(`  ${c.dim(`+${report.findings.length - 3} achado(s). Relatório completo: npx protocolo-serafim-um-setup doctor`)}`);
    out.push('');
  }
  console.log(out.join('\n'));
}

function toMarkdown(report) {
  const lines = [
    '# DIAGNÓSTICO — Protocolo Serafim UM (doctor)',
    '',
    `> Gerado em ${report.generatedAt.slice(0, 16).replace('T', ' ')} UTC · nota **${report.score}/100 (${report.grade})** · ${report.stack || 'stack não detectada'}`,
    '>',
    '> **Para a IA:** se houver achado CRÍTICO ou ALTO abaixo, avise o usuário em uma',
    '> frase ANTES de começar a tarefa pedida e ofereça corrigir primeiro. Não corrija',
    '> sem confirmar. Depois de corrigir, peça para rodar `npx protocolo-serafim-um-setup doctor` de novo.',
    '',
  ];
  if (!report.findings.length) lines.push('Nenhum problema encontrado nas checagens automáticas.');
  for (const f of report.findings) {
    lines.push(`## [${LABEL[f.severity]}] ${f.title}`);
    if (f.where.length) lines.push(`- **Onde:** ${f.where.join(', ')}`);
    lines.push(`- **Por quê:** ${f.why}`);
    lines.push(`- **Corrigir:** ${f.fix}`);
    lines.push(`- **Pergunta pronta:** ${f.prompt}`);
    lines.push('');
  }
  return lines.join('\n');
}

function writeReports(root, report) {
  const written = [];
  for (const dir of findMemoryDirs(root)) {
    const p = path.join(root, dir, 'DIAGNOSTICO.md');
    try { fs.writeFileSync(p, toMarkdown(report), 'utf8'); written.push(path.relative(root, p)); } catch { /* sem permissão: segue */ }
  }
  if (exists(path.join(root, 'src', 'qa', 'Watchdog.tsx'))) {
    const p = path.join(root, 'src', 'qa', 'doctor-report.json');
    try { fs.writeFileSync(p, JSON.stringify(report, null, 2), 'utf8'); written.push(path.relative(root, p)); } catch { /* idem */ }
  }
  return written;
}

function cli(argv) {
  const root = process.cwd();
  const report = runDoctor(root);
  const written = argv.includes('--no-write') ? [] : writeReports(root, report);
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    printReport(report);
    if (written.length) console.log(`  Relatório salvo em: ${written.join(', ')}\n`);
  }
  if (argv.includes('--ci') && (report.counts.critical || report.counts.high)) process.exitCode = 1;
}

module.exports = { runDoctor, printReport, writeReports, detectStack, findMemoryDirs, toMarkdown };

if (require.main === module) cli(process.argv.slice(2));
module.exports.cli = cli;
