#!/usr/bin/env node
/**
 * Protocolo Serafim UM — Setup Interativo
 *
 * Uso local:    node setup.js
 * Uso via npx:  npx protocolo-serafim-um-setup
 *               npx protocolo-serafim-um-setup doctor    (só o diagnóstico)
 *               npx protocolo-serafim-um-setup --check   (versão nova?)
 *
 * O que faz:
 *   1. Detecta a stack e o destino de deploy pelo próprio projeto e só
 *      pergunta o que não dá pra descobrir (Enter aceita a sugestão).
 *   2. Cria a pasta de memória — sem nunca sobrescrever arquivo que já
 *      existe (rodar de novo não apaga o estado real do projeto).
 *   3. Gera o CLAUDE.md a partir de templates/CLAUDE.md, com as "perguntas
 *      certas" que a IA cumpre antes de agir. Se já havia um CLAUDE.md da
 *      pessoa, não toca nele: grava o nosso ao lado pra IA fundir.
 *   4. Instala o git hook (se estiver num repositório git).
 *   5. Pacote completo: oferece o WATCHDOG.tsx (ausente no npm gratuito,
 *      então a etapa se autodesliga) já com nome/stack preenchidos, e o
 *      monta acrescentando um bloco dev-only no fim do main.tsx.
 *   6. Gera workflow de deploy, health check e .env.example pela stack
 *      detectada; pacote completo também liga o ESLint do protocolo. Nunca
 *      sobrescreve — conflito vira arquivo `-sugestao` ao lado.
 *   7. Roda o doctor: mostra a nota do projeto e grava o diagnóstico em
 *      <memória>/DIAGNOSTICO.md (lido pela IA) e, com Watchdog, em
 *      src/qa/doctor-report.json (aba Diagnóstico do painel).
 *
 * Suporta instalação 100% não-interativa (CI, scripts, outra IA
 * respondendo): se stdin não for um TTY, lê todas as respostas de uma vez
 * via pipe/redirect, na mesma ordem das perguntas.
 *
 * Pacote completo (WATCHDOG.tsx, módulos de auditoria, MCP Arsenal,
 * enforcement pack, 3 skills reais, checklist de 47 itens, as 17 regras +
 * 23 skills documentadas): https://serafimweb.com/serafim13/protocolo-um
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');

// ── CORES ──
const c = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
};

const g = s => `${c.green}${s}${c.reset}`;
const cy = s => `${c.cyan}${s}${c.reset}`;
const y = s => `${c.yellow}${s}${c.reset}`;
const b = s => `${c.bold}${s}${c.reset}`;
const d = s => `${c.dim}${s}${c.reset}`;

// ── UTILS ──
// `ask()` tem dois modos. Interativo (TTY, o caso normal de alguém rodando
// `npx` no próprio terminal): readline.question() de verdade. Não-TTY
// (stdin vem de arquivo/pipe — CI, automação, ou alguém scriptando o setup
// inteiro): lê tudo de stdin de uma vez e consome por linha.
//
// Achado real ao testar este script: readline.question() em sequência
// (await de 2+ perguntas) TRAVA SILENCIOSAMENTE na segunda pergunta quando
// stdin não é um TTY — o processo sai com código 0 sem criar nada e sem
// erro nenhum. É um bug de verdade do Node nessa combinação, não uma
// decisão de design. A solução abaixo evita o `readline.question()`
// encadeado no caso não-TTY por completo, em vez de torcer pra não
// acontecer de novo.
let nonTtyLines = null;
let nonTtyIndex = 0;
function ask(q) {
  if (process.stdin.isTTY) {
    return new Promise(res => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(q, (answer) => { rl.close(); res(answer); });
    });
  }
  if (nonTtyLines === null) {
    let raw = '';
    try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = ''; }
    nonTtyLines = raw.split(/\r?\n/);
  }
  const answer = nonTtyLines[nonTtyIndex] ?? '';
  nonTtyIndex += 1;
  process.stdout.write(q + answer + '\n');
  return Promise.resolve(answer);
}

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function copyFile(src, dst) {
  if (!exists(src)) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}

// ── TEMPLATES DIR (relativo a este script) ──
const TEMPLATES_DIR = __dirname;
const TARGET_DIR = process.cwd();

// Detecção de stack mora no doctor (fonte única) — o setup usa a mesma,
// pra os dois nunca discordarem sobre o que o projeto é.
const doctor = require('./doctor.js');

// ── ENFORCEMENT: ESLint ligado de verdade ──
function packageManager() {
  if (exists(path.join(TARGET_DIR, 'pnpm-lock.yaml'))) return { add: 'pnpm add', dev: 'pnpm add -D' };
  if (exists(path.join(TARGET_DIR, 'yarn.lock'))) return { add: 'yarn add', dev: 'yarn add -D' };
  if (exists(path.join(TARGET_DIR, 'bun.lockb')) || exists(path.join(TARGET_DIR, 'bun.lock'))) return { add: 'bun add', dev: 'bun add -d' };
  return { add: 'npm install', dev: 'npm install -D' };
}

function installDeps(cmd, pkgs) {
  if (process.env.PROTOCOLO_SKIP_INSTALL) return false; // testes de CI: não baixa nada da rede
  try {
    require('child_process').execSync(`${cmd} ${pkgs.join(' ')}`, { cwd: TARGET_DIR, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Liga as regras do protocolo no ESLint do projeto, respeitando o formato
// dele (ESM ou CommonJS). Sem ESLint instalado: instala e cria a config.
// Com config existente: acrescenta as regras sem remover nada; se o
// formato não for reconhecido com segurança, não edita e diz o que fazer.
function wireEslint(rulesSrc, detected) {
  const pkg = detected.pkg;
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const pm = packageManager();
  let hasEslint = !!deps.eslint;
  let hasTsEslint = !!(deps['typescript-eslint'] || deps['@typescript-eslint/eslint-plugin']);

  const existingConfig = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs']
    .map(f => path.join(TARGET_DIR, f)).find(exists);

  if (!hasEslint && !existingConfig) {
    const extra = detected.hasTypeScript ? 'typescript-eslint' : '@eslint/js';
    if (!installDeps(pm.dev, ['eslint', extra])) {
      console.log(`  ${y('!')} Não consegui instalar o ESLint — rode: ${cy(`${pm.dev} eslint ${extra}`)} e o setup de novo.`);
      return;
    }
    hasEslint = true;
    hasTsEslint = detected.hasTypeScript;
  }

  // Grava a versão das regras que este projeto consegue rodar: as regras
  // @typescript-eslint/* só entram se o plugin existir — sem ele, o ESLint
  // inteiro para com "plugin não encontrado".
  delete require.cache[require.resolve(rulesSrc)];
  const allRules = require(rulesSrc);
  const usable = allRules.filter(block => hasTsEslint || !Object.keys(block.rules || {}).some(r => r.startsWith('@typescript-eslint/')));
  writeFile(path.join(TARGET_DIR, 'eslint-serafim-rules.cjs'),
    '// Protocolo Serafim UM — regras do protocolo como erro de lint. Gerado pelo setup.\n' +
    `module.exports = ${JSON.stringify(usable, null, 2)};\n`);

  const isEsmFile = (file) => file.endsWith('.mjs') || (!file.endsWith('.cjs') && pkg.type === 'module');

  if (existingConfig) {
    let cfg = fs.readFileSync(existingConfig, 'utf8');
    const name = path.basename(existingConfig);
    if (cfg.includes('eslint-serafim-rules')) return;
    const openers = [
      /(export default\s*\[)/,
      /(module\.exports\s*=\s*\[)/,
      /((?:defineConfig|tseslint\.config)\(\s*\[?)/,
      /(const\s+eslintConfig\s*=\s*\[)/,
    ];
    const opener = openers.find(re => re.test(cfg));
    if (!opener) {
      console.log(`  ${y('!')} Não reconheci o formato de ${cy(name)} — regras gravadas em ${cy('eslint-serafim-rules.cjs')}.`);
      console.log(d(`    Peça à sua IA: "Adicione as regras de eslint-serafim-rules.cjs ao ${name} sem remover nada."`));
      return;
    }
    cfg = cfg.replace(opener, '$1\n  ...serafimRules,');
    const importLine = isEsmFile(existingConfig)
      ? "import serafimRules from './eslint-serafim-rules.cjs';"
      : "const serafimRules = require('./eslint-serafim-rules.cjs');";
    const lastImport = [...cfg.matchAll(/^(?:import .+|const .+ = require\(.+\);?)$/gm)].pop();
    cfg = lastImport
      ? cfg.slice(0, lastImport.index + lastImport[0].length) + '\n' + importLine + cfg.slice(lastImport.index + lastImport[0].length)
      : importLine + '\n' + cfg;
    fs.writeFileSync(existingConfig, cfg, 'utf8');
    console.log(`  ${g('✓')} ${cy(name)} atualizado com as regras do protocolo (nada removido)`);
  } else {
    const file = path.join(TARGET_DIR, 'eslint.config.js');
    const esm = isEsmFile(file);
    const ignores = "{ ignores: ['dist', 'build', '.next', 'out', 'coverage'] }";
    let body;
    if (hasTsEslint) {
      body = esm
        ? `import tseslint from 'typescript-eslint';\nimport serafimRules from './eslint-serafim-rules.cjs';\n\nexport default tseslint.config(\n  ${ignores},\n  ...tseslint.configs.recommended,\n  ...serafimRules,\n);\n`
        : `const tseslint = require('typescript-eslint');\nconst serafimRules = require('./eslint-serafim-rules.cjs');\n\nmodule.exports = tseslint.config(\n  ${ignores},\n  ...tseslint.configs.recommended,\n  ...serafimRules,\n);\n`;
    } else {
      body = esm
        ? `import js from '@eslint/js';\nimport serafimRules from './eslint-serafim-rules.cjs';\n\nexport default [\n  ${ignores},\n  js.configs.recommended,\n  ...serafimRules,\n];\n`
        : `const js = require('@eslint/js');\nconst serafimRules = require('./eslint-serafim-rules.cjs');\n\nmodule.exports = [\n  ${ignores},\n  js.configs.recommended,\n  ...serafimRules,\n];\n`;
    }
    writeFile(file, body);
    console.log(`  ${g('✓')} ESLint configurado (${cy('eslint.config.js')}) com as regras do protocolo`);
  }

  // Script "lint": é o que o CI do protocolo chama (npm run lint --if-present).
  if (hasEslint && !(pkg.scripts && pkg.scripts.lint)) {
    try {
      const pkgPath = path.join(TARGET_DIR, 'package.json');
      const fresh = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      fresh.scripts = { ...(fresh.scripts || {}), lint: 'eslint .' };
      fs.writeFileSync(pkgPath, JSON.stringify(fresh, null, 2) + '\n', 'utf8');
      console.log(`  ${g('✓')} Script ${cy('npm run lint')} adicionado ao package.json`);
    } catch {
      /* package.json ilegível: o resto continua valendo, o lint só não fica no script */
    }
  }
}

// ── SELEÇÃO DE TEMPLATE DE DEPLOY ──
// Keyword match na resposta livre da pergunta 4/5 — não é mágica, é
// correspondência direta. Se não casar com nada conhecido, usa o
// template genérico (build sem deploy, com TODO explícito) em vez de
// adivinhar e gerar um workflow que nunca vai funcionar.
function pickDeployTemplate(deployAnswer) {
  const a = (deployAnswer || '').toLowerCase();
  if (a.includes('vercel')) return 'vercel.yml';
  if (a.includes('netlify')) return 'netlify.yml';
  if (a.includes('railway')) return 'railway.yml';
  if (a.includes('hostinger') || a.includes('ftp') || a.includes('cpanel')) return 'hostinger-ftp.yml';
  return 'generic.yml';
}

// ── MAIN ──
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check') || args.includes('--version')) {
    require('./check-version.js');
    return;
  }
  if (args[0] === 'doctor') {
    doctor.cli(args.slice(1));
    return;
  }

  // Detecta antes de perguntar: o que dá pra descobrir sozinho vira
  // resposta padrão (Enter confirma) — quem está começando muitas vezes
  // não sabe responder "qual sua stack?".
  const detected = doctor.detectStack(TARGET_DIR);
  const pkgName = detected.pkg && typeof detected.pkg.name === 'string' ? detected.pkg.name : '';

  console.log('');
  console.log(b(cy('  ╔═══════════════════════════════════════════╗')));
  console.log(b(cy('  ║    PROTOCOLO SERAFIM UM — Setup            ║')));
  console.log(b(cy('  ║    Memória + infraestrutura + diagnóstico  ║')));
  console.log(b(cy('  ╚═══════════════════════════════════════════╝')));
  console.log('');
  console.log(d('  Responda o que eu não consigo descobrir sozinho. Enter aceita a sugestão.'));
  console.log('');

  const withDefault = (answer, fallback) => (answer.trim() || fallback || '').trim();

  // ── PERGUNTAS ──
  const name = withDefault(await ask(`  ${cy('1/5')} Nome do projeto ${d(pkgName ? `(Enter: ${pkgName})` : '(ex: Argus, VidGi, MeuApp)')}: `), pkgName) || 'Meu Projeto';
  const purpose = await ask(`  ${cy('2/5')} O que resolve e para quem ${d('(uma frase)')}: `);
  const stack = withDefault(await ask(`  ${cy('3/5')} Stack ${d(detected.label ? `(detectei: ${detected.label} — Enter confirma)` : '(ex: React + Vite + TypeScript + Supabase)')}: `), detected.label);
  const deploy = withDefault(await ask(`  ${cy('4/5')} Onde vai publicar ${d(detected.deploy ? `(detectei: ${detected.deploy} — Enter confirma)` : '(Vercel / Netlify / Railway / Hostinger — ou Enter se não sabe)')}: `), detected.deploy);
  const restrictions = await ask(`  ${cy('5/5')} Alguma restrição técnica? ${d('(Enter para pular)')}: `);

  console.log('');

  // ── NOME DA PASTA ──
  const suggested = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  const folderAnswer = await ask(`  ${cy('+')} Nome da pasta de memória ${d(`(Enter para .${suggested}`)}: `);
  const memFolder = '.' + (folderAnswer.trim() || suggested).replace(/^\./, '');

  console.log('');
  console.log(d('  ────────────────────────────────────────────'));
  console.log('');

  const today = new Date().toISOString().slice(0, 10);
  const memPath = path.join(TARGET_DIR, memFolder);

  // ── CRIAR IDENTITY.md ──
  const identity = `# IDENTITY — ${name}
Propósito: ${purpose}
Stack: ${stack}
Deploy: ${deploy}
Tom: Técnico e direto
Restrições: ${restrictions || 'Nenhuma restrição definida no setup inicial'}
Secrets: .env local (nunca no git)
Setup: Protocolo Serafim UM — ${today}
`;

  // ── CRIAR ESTADO_ATUAL.md ──
  const estado = `# ESTADO ATUAL — ${today}

## ÚLTIMA SESSÃO FEZ:
- Setup inicial via Protocolo Serafim UM (${today})

## PENDENTE:
- [ ] Preencher ROADMAP.md com as fases do projeto
- [ ] Configurar WATCHDOG.tsx com os endpoints reais
- [ ] Definir a primeira feature a implementar

## BLOQUEIOS:
- Nenhum

## PRÓXIMA SESSÃO COMEÇA COM:
Ler IDENTITY.md e ROADMAP.md, definir primeira tarefa concreta.
`;

  // ── CRIAR HISTORICO_DE_DECISOES.md ──
  const historico = `# HISTÓRICO DE DECISÕES

---

## [${today}] Setup inicial do projeto

**Decisão:** Adotar o Protocolo Serafim UM como sistema de memória e padrões de engenharia
**Motivo:** Garantir contexto persistente entre sessões de IA e padrões não-negociáveis
**Pasta de memória:** \`${memFolder}/\`
**Stack definida no setup:** ${stack}
**Deploy target:** ${deploy}
`;

  // ── CRIAR ROADMAP.md ──
  const roadmap = `# ROADMAP — ${name}

## FASE ATUAL: MVP
- [ ] [Defina aqui as 3-5 tarefas do MVP]

## PRÓXIMO PASSO (curto prazo):
- [ ] [O que vem depois do MVP]

## VISÃO DE LONGO PRAZO:
- [O que o produto quer ser em 1 ano]

---
*Atualizar este arquivo quando as fases mudarem.*
`;

  // ── CRIAR PROTOCOLO_UNIVERSAL.md ──
  const protocolo = `# PROTOCOLO UNIVERSAL — ${name}

## Regras deste projeto

Estas regras são específicas do projeto. As regras gerais de engenharia
estão no Protocolo Serafim UM (PROTOCOLO_SERAFIM_UM.md).

### Padrões de código
- TypeScript strict: true — zero \`any\` implícito
- Zod para validação de todo input externo
- Sem arquivos duplicados (v2, bkp, old)

### Segurança
- Secrets apenas em .env local — nunca commitados
- RLS em 100% das tabelas com dados de usuário (se Supabase)

### Performance
- Bundle < 500KB gzipped
- LCP < 2.5s

### Git
- Atualizar ${memFolder}/ESTADO_ATUAL.md antes de cada commit
- O hook pre-commit bloqueia commits sem contexto atualizado

---
*Adicione aqui regras específicas que emergirem deste projeto.*
`;

  // ── CRIAR CLAUDE.md (fonte única: templates/CLAUDE.md) ──
  const claudeTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'CLAUDE.md'), 'utf8');
  const claudeMd = claudeTemplate
    .replace(/\{\{MEM\}\}/g, memFolder)
    .replace(/\{\{NAME\}\}/g, name)
    .replace(/\{\{PURPOSE\}\}/g, purpose || '(propósito não informado no setup)')
    .replace(/\{\{STACK\}\}/g, stack || '(stack não informada)')
    .replace(/\{\{TODAY\}\}/g, today);

  // ── ESCREVER ARQUIVOS ──
  // Memória existente NUNCA é sobrescrita: rodar o setup de novo num
  // projeto que já usa o protocolo não pode apagar o estado real dele.
  console.log(`  ${g('✓')} Pasta de memória ${cy(memFolder + '/')}`);
  const memFiles = [
    ['IDENTITY.md', identity], ['ESTADO_ATUAL.md', estado], ['HISTORICO_DE_DECISOES.md', historico],
    ['ROADMAP.md', roadmap], ['PROTOCOLO_UNIVERSAL.md', protocolo],
  ];
  const created = [];
  const kept = [];
  for (const [file, content] of memFiles) {
    const p = path.join(memPath, file);
    if (exists(p)) { kept.push(file); continue; }
    writeFile(p, content);
    created.push(file);
  }
  if (created.length) console.log(`    ${d('criados: ' + created.join(', '))}`);
  if (kept.length) console.log(`    ${d('mantidos (já existiam, não toquei): ' + kept.join(', '))}`);

  // CLAUDE.md: só substitui se foi gerado por nós antes (upgrade). Se a
  // pessoa já tinha um próprio, o nosso vai ao lado e a IA faz a fusão.
  const claudePath = path.join(TARGET_DIR, 'CLAUDE.md');
  const existingClaude = exists(claudePath) ? fs.readFileSync(claudePath, 'utf8') : null;
  if (existingClaude === null || existingClaude.includes('Protocolo Serafim UM')) {
    writeFile(claudePath, claudeMd);
    console.log(`  ${g('✓')} ${cy('CLAUDE.md')} ${existingClaude === null ? 'criado' : 'atualizado'} — com as "perguntas certas" que a IA cumpre antes de agir`);
  } else {
    const altPath = path.join(TARGET_DIR, 'CLAUDE.protocolo-serafim.md');
    writeFile(altPath, claudeMd);
    console.log(`  ${y('!')} Você já tinha um CLAUDE.md — não toquei nele. O do protocolo está em ${cy('CLAUDE.protocolo-serafim.md')}.`);
    console.log(d('    Peça à sua IA: "Junte CLAUDE.protocolo-serafim.md ao meu CLAUDE.md sem perder nada do meu, e apague o arquivo extra."'));
  }

  // ── GIT HOOK ──
  const hookSrc = path.join(TEMPLATES_DIR, 'hooks', 'pre-commit');
  const hookDst = path.join(TARGET_DIR, '.git', 'hooks', 'pre-commit');
  const isGit = exists(path.join(TARGET_DIR, '.git'));

  if (isGit) {
    if (exists(hookSrc)) {
      let hookContent = fs.readFileSync(hookSrc, 'utf8');
      hookContent = hookContent.replace(/MEMORY_DIR="\.[^"]*"/, `MEMORY_DIR="${memFolder}"`);
      // Nunca destrói hook que a pessoa já tinha: só substitui o nosso (upgrade).
      const existingHook = exists(hookDst) ? fs.readFileSync(hookDst, 'utf8') : null;
      let customHooksPath = '';
      try {
        customHooksPath = require('child_process')
          .execSync('git config core.hooksPath', { cwd: TARGET_DIR, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      } catch { /* sem core.hooksPath configurado: o normal */ }
      try {
        if (existingHook !== null && !existingHook.includes('Protocolo Serafim UM')) {
          console.log(`  ${y('!')} Você já tem um hook pre-commit próprio — não toquei nele.`);
          console.log(d('    Peça à sua IA: "Inclua no meu pre-commit o aviso de atualizar o ESTADO_ATUAL.md do protocolo."'));
        } else if (customHooksPath) {
          console.log(`  ${y('!')} Seu git usa core.hooksPath (${customHooksPath}, ex: Husky) — hook em .git/hooks não rodaria. Não instalei.`);
          console.log(d('    Peça à sua IA: "Adicione ao hook pre-commit de ' + customHooksPath + ' o aviso de atualizar o ESTADO_ATUAL.md."'));
        } else {
          writeFile(hookDst, hookContent);
          try { fs.chmodSync(hookDst, '755'); } catch { /* Windows: o bit de execução não existe */ }
          console.log(`  ${g('✓')} Git hook instalado em ${cy('.git/hooks/pre-commit')} ${d(`(avisa se esquecer o ${memFolder}/ESTADO_ATUAL.md; PROTOCOLO_STRICT=1 passa a bloquear)`)}`);
        }
      } catch (err) {
        console.log(`  ${y('!')} Não consegui instalar o git hook (${err instanceof Error ? err.message : String(err)}) — o resto do setup está ok.`);
      }
    } else {
      console.log(`  ${y('!')} Hook template não encontrado em templates/hooks/pre-commit — instale manualmente.`);
    }
  } else {
    console.log(`  ${d('─')} Não é um repositório git — hook não instalado.`);
  }

  // ── WATCHDOG (só existe no pacote completo/pago — ausente na versão
  //    gratuita, então este passo se autodesliga: exists() retorna false) ──
  const watchdogSrc = path.join(TEMPLATES_DIR, 'WATCHDOG.tsx');
  const watchdogDst = path.join(TARGET_DIR, 'src', 'qa', 'Watchdog.tsx');
  if (exists(watchdogSrc)) {
    const watchdogAnswer = await ask(`\n  ${cy('?')} Instalar WATCHDOG.tsx em src/qa/Watchdog.tsx? ${d('[s/N]')}: `);
    const watchdogInstall = watchdogAnswer.trim().toLowerCase();
    if (watchdogInstall === 's' || watchdogInstall === 'sim' || watchdogInstall === 'y') {
      // Já sai configurado com o nome e a stack reais — nada pra editar à mão.
      const stackList = (stack || '').split('+').map(s => s.trim()).filter(Boolean);
      const wd = fs.readFileSync(watchdogSrc, 'utf8')
        .replace("name: 'MEU PROJETO'", `name: ${JSON.stringify(name)}`)
        .replace("stack: ['React', 'TypeScript', 'Tailwind']", `stack: ${JSON.stringify(stackList.length ? stackList : ['React'])}`);
      writeFile(watchdogDst, wd);
      copyFile(path.join(TEMPLATES_DIR, 'watchdog.css'), path.join(TARGET_DIR, 'src', 'qa', 'watchdog.css'));
      console.log(`  ${g('✓')} WATCHDOG instalado em ${cy('src/qa/Watchdog.tsx')} ${d('(nome e stack já preenchidos)')}`);

      // O painel usa lucide-react (ícones). Sem ela, o import quebra o app
      // em dev — instala com o gerenciador que o projeto já usa.
      const deps = detected.pkg ? { ...(detected.pkg.dependencies || {}), ...(detected.pkg.devDependencies || {}) } : {};
      if (detected.pkg && !deps['lucide-react']) {
        const pm = packageManager();
        if (installDeps(pm.add, ['lucide-react'])) {
          console.log(`  ${g('✓')} Dependência do painel instalada: ${cy('lucide-react')}`);
        } else {
          console.log(`  ${y('!')} Não consegui instalar lucide-react — rode: ${cy(`${pm.add} lucide-react`)}`);
        }
      }
    }
  }
  const watchdogInstalled = exists(watchdogDst);

  // ── FASE 2 — INFRAESTRUTURA (deploy, health check, .env.example) ──
  console.log('');
  console.log(b('  Infraestrutura:'));

  // Deploy — só escreve se não existir workflow nenhum ainda (nunca
  // sobrescreve um pipeline de deploy que a pessoa já tem rodando).
  const deployWorkflowDst = path.join(TARGET_DIR, '.github', 'workflows', 'deploy.yml');
  const deployTemplateName = pickDeployTemplate(deploy);
  const deployTemplateSrc = path.join(TEMPLATES_DIR, 'deploy-templates', deployTemplateName);
  if (exists(deployTemplateSrc)) {
    if (!exists(deployWorkflowDst)) {
      copyFile(deployTemplateSrc, deployWorkflowDst);
      console.log(`  ${g('✓')} Workflow de deploy gerado: ${cy('.github/workflows/deploy.yml')} ${d(`(${deployTemplateName.replace('.yml', '')})`)}`);
    } else {
      const altDst = path.join(TARGET_DIR, '.github', 'workflows', 'deploy-protocolo-sugestao.yml');
      copyFile(deployTemplateSrc, altDst);
      console.log(`  ${y('!')} Já existe .github/workflows/deploy.yml — sugestão salva sem sobrescrever: ${cy('deploy-protocolo-sugestao.yml')}`);
    }
  }

  // Supabase Edge Functions — workflow adicional, só se o projeto usa Supabase
  if (detected.hasSupabase) {
    const addonSrc = path.join(TEMPLATES_DIR, 'deploy-templates', 'supabase-functions-addon.yml');
    const addonDst = path.join(TARGET_DIR, '.github', 'workflows', 'deploy-supabase-functions.yml');
    if (exists(addonSrc) && !exists(addonDst)) {
      copyFile(addonSrc, addonDst);
      console.log(`  ${g('✓')} Workflow de Edge Functions gerado: ${cy('.github/workflows/deploy-supabase-functions.yml')}`);
    }
  }

  // Health check — escolhe o template certo pela stack detectada. Sem
  // package.json ou sem stack reconhecida: pula e avisa, não adivinha.
  let healthTemplate = null;
  let healthDst = null;
  if (detected.hasNext) {
    healthTemplate = 'nextjs-route.ts';
    healthDst = path.join(TARGET_DIR, 'app', 'api', 'health', 'route.ts');
  } else if (detected.hasSupabase) {
    healthTemplate = 'supabase-edge-function.ts';
    healthDst = path.join(TARGET_DIR, 'supabase', 'functions', 'health', 'index.ts');
  } else if (detected.hasExpress) {
    healthTemplate = 'express-route.js';
    healthDst = path.join(TARGET_DIR, 'routes', 'health.js');
  }
  if (healthTemplate) {
    const healthSrc = path.join(TEMPLATES_DIR, 'health-templates', healthTemplate);
    if (exists(healthSrc) && !exists(healthDst)) {
      copyFile(healthSrc, healthDst);
      console.log(`  ${g('✓')} Health check gerado: ${cy(path.relative(TARGET_DIR, healthDst))}`);
    }
  } else if (detected.pkg) {
    console.log(`  ${d('─')} Stack não reconhecida pro health check automático (Next.js, Express ou Supabase) — pulado, sem adivinhar.`);
  }

  // .env.example — só gera campos do que foi detectado; nunca sobrescreve
  const envDst = path.join(TARGET_DIR, '.env.example');
  if (detected.pkg && !exists(envDst)) {
    // Variáveis que o NAVEGADOR lê precisam do prefixo do framework — sem
    // ele, o valor chega como undefined e o app quebra sem erro nenhum.
    // E o inverso é pior: chave secreta COM prefixo público vai parar no
    // bundle que qualquer visitante baixa.
    const pub = detected.hasNext ? 'NEXT_PUBLIC_' : detected.hasVite ? 'VITE_' : '';
    const lines = ['# Gerado pelo Protocolo Serafim UM — preencha os valores reais em .env (nunca commitado)', ''];
    if (pub) {
      lines.push(`# Variáveis com ${pub} vão pro navegador (públicas). NUNCA coloque esse prefixo numa chave secreta.`, '');
    }
    if (detected.hasSupabase) {
      lines.push(`${pub}SUPABASE_URL=`, `${pub}SUPABASE_ANON_KEY=`, '');
      lines.push('# Secreta: só backend/Edge Functions. Ignora RLS — nunca no frontend, nunca com prefixo público.');
      lines.push('SUPABASE_SERVICE_ROLE_KEY=', '');
    }
    if (detected.hasStripe) {
      if (pub) lines.push(`${pub}STRIPE_PUBLISHABLE_KEY=`);
      lines.push('# Secretas: só backend. Use sk_test_ até ir pra produção de verdade.');
      lines.push('STRIPE_SECRET_KEY=', 'STRIPE_WEBHOOK_SECRET=', '');
    }
    if (detected.hasResend) lines.push('RESEND_API_KEY=', '');
    if (detected.hasSupabase || detected.hasStripe || detected.hasResend) {
      writeFile(envDst, lines.join('\n') + '\n');
      console.log(`  ${g('✓')} ${cy('.env.example')} gerado a partir da stack detectada`);
    }
  }

  // Enforcement pack (ESLint) — só existe no pacote pago (mesmo padrão de
  // autodesligamento do Watchdog: ausente no npm gratuito).
  const eslintRulesSrc = path.join(TEMPLATES_DIR, '..', 'enforcement', 'eslint-serafim-rules.cjs');
  if (exists(eslintRulesSrc) && detected.pkg) {
    wireEslint(eslintRulesSrc, detected);
  }

  // Watchdog auto-mount — ACRESCENTA um bloco no fim do main.tsx em vez de
  // editar o JSX existente: funciona com qualquer formato de arquivo e não
  // mexe em nada que já estava lá. O `if (import.meta.env.DEV)` faz o
  // painel (e o relatório do doctor que ele mostra) nunca entrar no build
  // de produção — o PIN fica no JS do cliente, então não é proteção.
  if (watchdogInstalled) {
    const mainPath = ['src/main.tsx', 'src/main.jsx'].map(f => path.join(TARGET_DIR, f)).find(exists);
    const reactOk = !detected.reactMajor || detected.reactMajor >= 18;
    if (mainPath && reactOk) {
      const mainSrc = fs.readFileSync(mainPath, 'utf8');
      if (!mainSrc.includes('qa/Watchdog')) {
        const block = [
          '',
          '// Protocolo Serafim UM — Watchdog (Shift+D). Só existe em desenvolvimento:',
          '// o if abaixo some do build de produção, junto com o painel.',
          'if (import.meta.env.DEV) {',
          "  Promise.all([import('./qa/Watchdog'), import('react-dom/client')]).then(([{ Watchdog }, { createRoot }]) => {",
          "    const host = document.createElement('div');",
          "    host.id = 'serafim-watchdog';",
          '    document.body.appendChild(host);',
          '    createRoot(host).render(<Watchdog />);',
          '  });',
          '}',
          '',
        ].join('\n');
        fs.writeFileSync(mainPath, mainSrc.replace(/\s*$/, '\n') + block, 'utf8');
        console.log(`  ${g('✓')} WATCHDOG montado em ${cy(path.relative(TARGET_DIR, mainPath))} ${d('(só em dev · Shift+D · PIN 2026)')}`);
      }
    } else {
      console.log(`  ${y('!')} Não achei src/main.tsx (ou o React é anterior ao 18) — peça à sua IA:`);
      console.log(d('    "Monte o componente de src/qa/Watchdog.tsx no app, só em desenvolvimento (import.meta.env.DEV)."'));
    }
  }

  // ── FASE 3 — DIAGNÓSTICO (doctor) ──
  // O setup termina com a nota do projeto: a pessoa sai sabendo o que
  // corrigir, e a IA recebe o mesmo relatório em <memória>/DIAGNOSTICO.md.
  console.log('');
  console.log(b('  Diagnóstico do projeto:'));
  try {
    const report = doctor.runDoctor(TARGET_DIR);
    doctor.writeReports(TARGET_DIR, report);
    doctor.printReport(report, { compact: true });
  } catch (err) {
    console.log(`  ${y('!')} O diagnóstico não rodou (${err instanceof Error ? err.message : String(err)}) — o resto do setup está ok.`);
  }

  // ── RESUMO ──
  console.log(d('  ────────────────────────────────────────────'));
  console.log('');
  console.log(b(`  ${g('✓')} Protocolo ativo em ${cy(name)}`));
  console.log('');
  console.log(b('  Próximo passo — abra sua IA e cole:'));
  console.log(cy('     "Leia o CLAUDE.md e o ' + memFolder + '/DIAGNOSTICO.md. Me diga o que entendeu do'));
  console.log(cy('      projeto e qual problema do diagnóstico devemos corrigir primeiro."'));
  console.log('');
  console.log(d('  Diagnóstico de novo, a qualquer momento:  npx protocolo-serafim-um-setup doctor'));
  console.log('');
  if (!watchdogInstalled) {
    console.log(d('  Versão gratuita (MIT). O pacote completo mostra este diagnóstico dentro do'));
    console.log(d('  app (Watchdog, Shift+D), traz o enforcement pack que quebra o build quando'));
    console.log(d('  uma regra é violada, skills prontas e os módulos de auditoria:'));
    console.log(d('  https://serafimweb.com/serafim13/protocolo-um'));
    console.log('');
  }
}

main().catch(err => {
  console.error(`\n  ${c.red}Erro:${c.reset}`, err.message);
  process.exit(1);
});
