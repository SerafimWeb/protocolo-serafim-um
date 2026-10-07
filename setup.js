#!/usr/bin/env node
/**
 * Protocolo Serafim UM — Setup Interativo
 *
 * Uso local:    node setup.js
 * Uso via npx:  npx protocolo-serafim-um-setup
 *
 * O que faz:
 *   1. Pergunta 5 coisas sobre o projeto
 *   2. Cria a pasta de memória com os arquivos preenchidos
 *   3. Copia o CLAUDE.md para a raiz
 *   4. Instala o git hook (se estiver num repositório git)
 *   5. Se WATCHDOG.tsx existir ao lado deste script, pergunta se instala
 *      (só está presente no pacote completo/pago — a versão gratuita
 *      publicada no npm não inclui esse arquivo, então esta etapa se
 *      autodesliga sozinha para quem instalou via npx).
 *   6. Detecta a stack do projeto (lê o package.json de quem está
 *      instalando) e, sem perguntar de novo: gera o workflow de deploy
 *      certo (Vercel/Netlify/Railway/Hostinger, pela resposta da pergunta
 *      4), gera o health check certo (Next.js/Express/Supabase Edge
 *      Function), gera `.env.example` com as variáveis da stack
 *      detectada, e cria/atualiza o `eslint.config.js` com as regras do
 *      protocolo (pacote completo). Nunca sobrescreve arquivo que já
 *      existe — gera ao lado com sufixo `-sugestao` quando há conflito.
 *   7. Se o Watchdog foi instalado nesta rodada, tenta montar
 *      automaticamente em `src/main.tsx`/`main.jsx` — só quando reconhece
 *      com confiança o formato (Vite+React padrão). Em qualquer outro
 *      caso, não toca no arquivo e imprime o snippet exato: editar
 *      arquivo de quem está instalando sem certeza é pior do que pedir
 *      2 linhas manuais.
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

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// ── TEMPLATES DIR (relativo a este script) ──
const TEMPLATES_DIR = __dirname;
const TARGET_DIR = process.cwd();

// ── DETECÇÃO DE STACK ──
// Lê o package.json do projeto ONDE o setup está rodando (não deste
// pacote) pra decidir, sem perguntar, qual template de health/deploy
// se aplica. Sem package.json (projeto não-Node ainda não iniciado):
// tudo vira indefinido e os passos de infra avisam e pulam, nunca
// adivinham às cegas.
function detectStack() {
  const pkg = readJsonSafe(path.join(TARGET_DIR, 'package.json'));
  const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
  return {
    pkg,
    hasNext: !!deps.next,
    hasVite: !!deps.vite,
    hasReact: !!deps.react,
    hasExpress: !!deps.express,
    hasSupabase: !!deps['@supabase/supabase-js'],
    hasStripe: !!(deps.stripe || deps['@stripe/stripe-js']),
    hasResend: !!deps.resend,
  };
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
  if (process.argv.includes('--check') || process.argv.includes('--version')) {
    require('./check-version.js');
    return;
  }

  console.log('');
  console.log(b(cy('  ╔═══════════════════════════════════════════╗')));
  console.log(b(cy('  ║    PROTOCOLO SERAFIM UM — Setup            ║')));
  console.log(b(cy('  ║    Sistema de Memória Persistente          ║')));
  console.log(b(cy('  ╚═══════════════════════════════════════════╝')));
  console.log('');
  console.log(d('  Responda 5 perguntas. Em 60 segundos, o protocolo está rodando.'));
  console.log('');

  // ── PERGUNTAS ──
  const name = await ask(`  ${cy('1/5')} Nome do projeto ${d('(ex: Argus, VidGi, MeuApp)')}: `);
  const purpose = await ask(`  ${cy('2/5')} O que resolve e para quem ${d('(uma frase)')}: `);
  const stack = await ask(`  ${cy('3/5')} Stack ${d('(ex: React + Vite + TypeScript + Supabase)')}: `);
  const deploy = await ask(`  ${cy('4/5')} Deploy ${d('(ex: Vercel / Railway / Hostinger FTP)')}: `);
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

  // ── CRIAR CLAUDE.md ──
  const claudeMd = `# CLAUDE.md — Protocolo de Operação

> Este arquivo é lido automaticamente por Claude Code, Cursor e agentes compatíveis.
> NÃO remova. Ele é a lei do projeto para qualquer IA que trabalhe aqui.

## PASSO ZERO — OBRIGATÓRIO ANTES DE QUALQUER AÇÃO

1. Ler \`${memFolder}/IDENTITY.md\` — quem é este projeto, qual é o stack, quais são as restrições
2. Ler \`${memFolder}/ESTADO_ATUAL.md\` — onde a última sessão parou e o que vem a seguir
3. Ler \`${memFolder}/ROADMAP.md\` — visão macro do projeto

Somente então iniciar o trabalho solicitado.

## IDENTIDADE DO PROJETO

O contexto completo está em \`${memFolder}/IDENTITY.md\`.

Projeto: ${name}
Propósito: ${purpose}
Stack: ${stack}

## REGRAS ABSOLUTAS

- TypeScript Strict. Zero \`any\` implícito. Inputs externos validados com Zod.
- Sem secrets no código. Nunca em arquivo versionado.
- Sem arquivos duplicados. Versionar é função do Git.
- RLS em tabelas com dados de usuário.
- Nenhuma migration sem script DOWN.
- Performance Budget: Bundle < 500KB. LCP < 2.5s.

## PADRÕES DE ARQUITETURA

\`\`\`
UI         → Componentes puros. Zero lógica de negócio.
Lógica     → Hooks e services. Testáveis de forma isolada.
Infra      → Clientes externos (supabase, stripe, etc.).
\`\`\`

## ENCERRAMENTO DE SESSÃO

- [ ] \`${memFolder}/ESTADO_ATUAL.md\` reflete o estado real pós-sessão?
- [ ] \`${memFolder}/HISTORICO_DE_DECISOES.md\` tem nova entrada?
- [ ] Nenhum secret exposto?
- [ ] Build passa sem erros?

---
*CLAUDE.md gerado pelo Protocolo Serafim UM em ${today}*
`;

  // ── ESCREVER ARQUIVOS ──
  console.log(`  ${g('✓')} Criando ${cy(memFolder + '/')}...`);
  writeFile(path.join(memPath, 'IDENTITY.md'), identity);
  writeFile(path.join(memPath, 'ESTADO_ATUAL.md'), estado);
  writeFile(path.join(memPath, 'HISTORICO_DE_DECISOES.md'), historico);
  writeFile(path.join(memPath, 'ROADMAP.md'), roadmap);
  writeFile(path.join(memPath, 'PROTOCOLO_UNIVERSAL.md'), protocolo);
  console.log(`    ${d('IDENTITY.md, ESTADO_ATUAL.md, HISTORICO_DE_DECISOES.md, ROADMAP.md, PROTOCOLO_UNIVERSAL.md')}`);

  console.log(`  ${g('✓')} Escrevendo ${cy('CLAUDE.md')} na raiz...`);
  writeFile(path.join(TARGET_DIR, 'CLAUDE.md'), claudeMd);

  // ── GIT HOOK ──
  const hookSrc = path.join(TEMPLATES_DIR, 'hooks', 'pre-commit');
  const hookDst = path.join(TARGET_DIR, '.git', 'hooks', 'pre-commit');
  const isGit = exists(path.join(TARGET_DIR, '.git'));

  if (isGit) {
    if (exists(hookSrc)) {
      let hookContent = fs.readFileSync(hookSrc, 'utf8');
      hookContent = hookContent.replace(/MEMORY_DIR="\.[^"]*"/, `MEMORY_DIR="${memFolder}"`);
      writeFile(hookDst, hookContent);
      try { fs.chmodSync(hookDst, '755'); } catch {}
      console.log(`  ${g('✓')} Git hook instalado em ${cy('.git/hooks/pre-commit')} ${d(`(MEMORY_DIR="${memFolder}")`)}`);
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
      copyFile(watchdogSrc, watchdogDst);
      console.log(`  ${g('✓')} WATCHDOG instalado em ${cy('src/qa/Watchdog.tsx')}`);
    }
  }
  const watchdogInstalled = exists(watchdogDst);

  // ── FASE 2 — INFRAESTRUTURA (deploy, health check, .env.example) ──
  console.log('');
  console.log(b('  Infraestrutura:'));
  const detected = detectStack();

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
    const lines = ['# Gerado pelo Protocolo Serafim UM — preencha os valores reais em .env (nunca commitado)', ''];
    if (detected.hasSupabase) lines.push('SUPABASE_URL=', 'SUPABASE_ANON_KEY=', 'SUPABASE_SERVICE_ROLE_KEY=', '');
    if (detected.hasStripe) lines.push('STRIPE_SECRET_KEY=', 'STRIPE_WEBHOOK_SECRET=', '');
    if (detected.hasResend) lines.push('RESEND_API_KEY=', '');
    if (lines.length > 2) {
      writeFile(envDst, lines.join('\n') + '\n');
      console.log(`  ${g('✓')} ${cy('.env.example')} gerado a partir da stack detectada`);
    }
  }

  // Enforcement pack (ESLint) — só existe no pacote pago (mesmo padrão de
  // autodesligamento do Watchdog: ausente no npm gratuito).
  const eslintRulesSrc = path.join(TEMPLATES_DIR, '..', 'enforcement', 'eslint-serafim-rules.cjs');
  if (exists(eslintRulesSrc)) {
    const flatConfigPaths = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs']
      .map(f => path.join(TARGET_DIR, f));
    const existingFlatConfig = flatConfigPaths.find(exists);
    const rulesDst = path.join(TARGET_DIR, 'eslint-serafim-rules.cjs');
    copyFile(eslintRulesSrc, rulesDst);

    if (existingFlatConfig) {
      let cfg = fs.readFileSync(existingFlatConfig, 'utf8');
      if (!cfg.includes('eslint-serafim-rules')) {
        const marker = /(export default\s*\[|module\.exports\s*=\s*\[)/;
        if (marker.test(cfg)) {
          cfg = cfg.replace(marker, `$1\n  require('./eslint-serafim-rules.cjs'),`);
          fs.writeFileSync(existingFlatConfig, cfg, 'utf8');
          console.log(`  ${g('✓')} ${cy(path.basename(existingFlatConfig))} atualizado com as regras do protocolo`);
        } else {
          console.log(`  ${y('!')} ${cy(path.basename(existingFlatConfig))} existe mas não reconheci o formato — regras copiadas pra ${cy('eslint-serafim-rules.cjs')}, importe manualmente.`);
        }
      }
    } else {
      writeFile(path.join(TARGET_DIR, 'eslint.config.js'), `module.exports = [require('./eslint-serafim-rules.cjs')];\n`);
      console.log(`  ${g('✓')} ${cy('eslint.config.js')} criado com as regras do protocolo (projeto não tinha nenhum)`);
    }
  }

  // Watchdog auto-mount — só tenta se foi instalado nesta rodada. Só
  // edita main.tsx se o padrão for um dos dois formatos mais comuns do
  // Vite+React; em qualquer outro caso, não toca no arquivo e imprime o
  // snippet exato — corromper o primeiro contato da pessoa com o produto
  // é pior do que pedir 2 linhas manuais.
  if (watchdogInstalled) {
    const mainCandidates = ['src/main.tsx', 'src/main.jsx'].map(f => path.join(TARGET_DIR, f));
    const mainPath = mainCandidates.find(exists);
    if (mainPath) {
      let mainSrc = fs.readFileSync(mainPath, 'utf8');
      const alreadyWired = mainSrc.includes('Watchdog');
      const patterns = [
        { re: /(<StrictMode>\s*)(<App\s*\/>)(\s*<\/StrictMode>)/, replace: '$1$2{import.meta.env.DEV && <Watchdog />}$3' },
        { re: /(render\(\s*)(<App\s*\/>)(\s*\))/, replace: '$1<>$2{import.meta.env.DEV && <Watchdog />}</>$3' },
      ];
      const match = patterns.find(p => p.re.test(mainSrc));
      if (!alreadyWired && match) {
        mainSrc = mainSrc.replace(match.re, match.replace);
        if (!/import\s*\{\s*Watchdog\s*\}/.test(mainSrc)) {
          mainSrc = mainSrc.replace(/^(import [^\n]+\n)/, `$1import { Watchdog } from './qa/Watchdog';\n`);
        }
        fs.writeFileSync(mainPath, mainSrc, 'utf8');
        console.log(`  ${g('✓')} WATCHDOG montado automaticamente em ${cy(path.relative(TARGET_DIR, mainPath))} ${d('(Shift+D para abrir · PIN: 2026)')}`);
      } else if (!alreadyWired) {
        console.log(`  ${y('!')} Não reconheci o formato de ${cy(path.relative(TARGET_DIR, mainPath))} com segurança — monte manualmente:`);
        console.log(d("    import { Watchdog } from './qa/Watchdog';  →  <Watchdog />  junto do <App />"));
      }
    } else {
      console.log(`  ${y('!')} Não achei src/main.tsx ou src/main.jsx — monte o Watchdog manualmente:`);
      console.log(d("    import { Watchdog } from './qa/Watchdog';  →  <Watchdog />  →  Shift+D · PIN: 2026"));
    }
  }

  // ── RESUMO ──
  console.log('');
  console.log(d('  ────────────────────────────────────────────'));
  console.log('');
  console.log(b(`  ${g('✓')} Protocolo ativo em ${cy(name)}`));
  console.log('');
  console.log(`  Pasta de memória : ${cy(memFolder + '/')}`);
  console.log(`  CLAUDE.md        : ${cy('CLAUDE.md')}`);
  if (isGit) console.log(`  Git hook         : ${cy('.git/hooks/pre-commit')}`);
  console.log('');
  console.log(b('  Próximos passos:'));
  console.log(`  ${cy('1.')} Abra sua IA e diga:`);
  console.log(d('     "Leia o CLAUDE.md e me diga o que você entendeu sobre este projeto."'));
  console.log(`  ${cy('2.')} Se a resposta vier com o contexto correto → você está operando.`);
  console.log('');
  if (!exists(watchdogDst)) {
    console.log(d('  Isto instalou a versão gratuita (MIT). O pacote completo adiciona'));
    console.log(d('  WATCHDOG.tsx, módulos de auditoria, MCP Arsenal e o checklist de 47'));
    console.log(d('  itens: https://serafimweb.com/serafim13/protocolo-um'));
    console.log('');
  }
}

main().catch(err => {
  console.error(`\n  ${c.red}Erro:${c.reset}`, err.message);
  process.exit(1);
});
