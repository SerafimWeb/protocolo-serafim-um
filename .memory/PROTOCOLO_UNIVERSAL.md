# PROTOCOLO UNIVERSAL DE ENGENHARIA
## Versão 2.0 — parte do Protocolo Serafim UM

> Este é o documento de rigor técnico absoluto. Ele define o **Como** fazemos,
> independente de **Quem** somos ou **O que** vendemos.
>
> É portável. Copie-o integralmente para qualquer projeto, seu ou de cliente.
> O posicionamento, tom de voz e identidade ficam em `IDENTITY.md`.

---

## ESTRUTURA DA PASTA DE MEMÓRIA (OBRIGATÓRIA EM TODO PROJETO)

```
.memory/                      ← renomeie para o nome do seu projeto: .argus/, .meuapp/, etc.
├── PROTOCOLO_UNIVERSAL.md   ← ESTE ARQUIVO. Regras técnicas imutáveis.
├── IDENTITY.md              ← Alma do projeto: tom, marca, missão. Personalizado.
├── ESTADO_ATUAL.md          ← RAM viva: onde parou, o que está pendente.
├── ROADMAP.md               ← Fases macro: curto, médio e longo prazo.
└── HISTORICO_DE_DECISOES.md ← Cofre append-only. Novas entradas sempre no topo.
```

**Como usar:**
- **Projeto novo**: copie esta pasta inteira para a raiz do projeto (renomeada), preencha o `IDENTITY.md` com o DNA do projeto, e o `CLAUDE.md` da raiz com as referências ao nome escolhido.
- **Projeto cliente/terceiro**: copie apenas o `PROTOCOLO_UNIVERSAL.md` se só o rigor técnico importar. Crie um `IDENTITY.md` limpo com o briefing específico daquele projeto.

---

## PARTE I — FUNDAÇÃO (Todo projeto, sem exceção)

### [P1: SSOT & MEMÓRIA CENTRALIZADA]
O único estado oficial do projeto é a pasta `.serafim/`.
- Antes de qualquer ação: ler `ESTADO_ATUAL.md`.
- Ao finalizar qualquer tarefa: atualizar `ESTADO_ATUAL.md` e adicionar entrada no topo de `HISTORICO_DE_DECISOES.md`.
- Rascunhos voláteis (`.claude/`, logs de dev) são permitidos, mas não são fonte de verdade.

### [P2: ISOLAMENTO ABSOLUTO DE SECRETS]
Cada projeto tem seus próprios secrets. É proibido reutilizar chaves entre projetos.
- `.env` real: nunca commitado, listado no `.gitignore`.
- `.env.example`: sempre versionado e atualizado.
- Em produção: secrets vêm do host (Hostinger env, Supabase Vault, Railway), nunca de arquivos.
- Chaves críticas (live Stripe, Supabase service_role): data de rotação documentada no `HISTORICO_DE_DECISOES.md`.

### [P3: UNICIDADE ESTRITA]
Proibido criar clones de arquivos (`index_v2.html`, `main_bkp.js`).
Toda mudança é feita diretamente no arquivo canônico.
Versionar é função do Git, não do nome do arquivo.

---

## PARTE II — QUALIDADE DE CÓDIGO

### [Q1: TYPE SAFETY RIGOROSO]
- TypeScript com `strict: true` em todos os projetos TS.
- Zero `any` implícito. Todo input de API validado com **Zod** na borda de entrada.

### [Q2: ARQUITETURA FRACTAL]
```
UI       → Componentes puros, sem lógica de negócio.
Lógica   → Hooks e Services, testáveis de forma isolada.
Infra    → Clientes de API, adapters de banco, configs.
```
Proibido "spaghetti code". Se um arquivo passa de 300 linhas, questione a separação.

### [Q3: CÓDIGO DEFENSIVO]
- Programe para o pior cenário. Antecipe nulos e edge cases.
- Todo bloco crítico: `try/catch/finally` com mensagem de erro útil no log.
- Nunca `console.log` em produção. Usar logger centralizado com níveis (`info`, `warn`, `error`).

### [Q4: OBSERVABILIDADE FORENSE]
- Toda mutação de dado (CREATE, UPDATE, DELETE) sensível deve ser logada em tabela de auditoria (`audit_trail`) no banco.
- Logs devem conter: timestamp, usuário, ação, payload (sanitizado), resultado.
- Em chamadas cross-service, logar origem + destino + latência.

### [Q5: TESTES EM TRÊS CAMADAS]
- **Unit**: Lógica de negócio isolada (Vitest ou Jest).
- **Integration**: API + banco real, sem mocks de banco. Se passou no mock e quebrou em prod, o teste não existiu.
- **E2E**: Fluxo crítico do usuário (Playwright).

---

## PARTE III — SEGURANÇA (HARDENING)

### [S1: ZERO-TRUST NO BACKEND]
O backend desconfia de 100% dos inputs.
- Validação com Zod antes de qualquer processamento.
- Supabase: RLS (Row Level Security) ativa em 100% das tabelas com dados de usuário.
- Nenhum dado de um usuário/org é visível para outro. Multi-tenancy via `org_id` / `user_id`.

### [S2: HEADERS DE SEGURANÇA (HTTP)]
Todo servidor web ou `.htaccess` deve entregar:
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; [ajustar por projeto]
```
Remover headers de fingerprint: `Server`, `X-Powered-By`.

### [S3: BOT PROTECTION]
No `robots.txt` e `.htaccess`, bloquear:
- User-agents de scrapers agressivos (AhrefsBot, SemrushBot, MJ12bot, CCBot).
- Diretórios internos: `/admin/`, `/api/private/`, `/src/`, `/dist/`, `/node_modules/`.
- Permitir explicitamente: Googlebot, Bingbot, GPTBot, ClaudeBot, PerplexityBot.

### [S4: MIGRATION FORTRESS]
Toda migration de banco tem script `up` E `down`.
Nenhum `DROP` ou `ALTER` destrutivo vai para produção sem backup documentado.
Migrations testadas em staging antes de produção.

---

## PARTE IV — PERFORMANCE

### [P1: PERFORMANCE BUDGET]
Thresholds obrigatórios (medir com Lighthouse/PageSpeed):
- **LCP** (Largest Contentful Paint): < 2.5s
- **CLS** (Cumulative Layout Shift): < 0.1
- **Bundle principal**: < 500KB gzipped

Boas práticas:
- Imagens: formato WebP com `loading="lazy"` e atributos `width/height`.
- Fontes: `font-display: swap` e preload para fontes críticas.
- Rotas pesadas: lazy-loaded (import dinâmico).
- Assets estáticos: cache com headers `Expires` longos.

### [P2: ENCAPSULAMENTO DE ASSETS]
Assets estáticos residem ÚNICA e EXCLUSIVAMENTE na pasta `public/` (Vite/Next) ou equivalente.
Nunca referenciar arquivos fora desta pasta no código de produção.

---

## PARTE V — VISIBILIDADE COGNITIVA (SEO, GEO, AEO)

### [V1: LLMS.TXT — GUIA PARA IAS]
Todo site público deve ter `/llms.txt` na raiz.
Formato Markdown com:
- `# Nome do Projeto`
- `> Descrição em 1-2 frases`
- Seções com links para as páginas mais importantes.

### [V2: DADOS ESTRUTURADOS (JSON-LD)]
Injetar no `<head>` de cada página:
- Tipo mínimo: `Organization` ou `WebApplication` (Schema.org).
- Inclui: `name`, `url`, `description`, `author`.

### [V3: SITEMAP.XML & ROBOTS.TXT]
- `sitemap.xml`: Todas as URLs públicas canônicas, com `<lastmod>` e `<priority>`.
- `robots.txt`: Referência ao sitemap na última linha. Bloquear diretórios privados.

### [V4: META TAGS ESSENCIAIS]
```html
<title>[Palavra-chave principal] — [Nome do site]</title>
<meta name="description" content="[150-160 chars, inclua KW principal]">
<meta property="og:title" content="...">
<meta property="og:description" content="...">
<meta property="og:image" content="[1200x630px]">
<meta property="og:url" content="[URL canônica]">
```

---

## PARTE VI — MONITORAMENTO SOBERANO

### [M1: ANALYTICS]
- **GA4**: Tag instalada em todo projeto público. ID de medição separado por domínio.
- **Google Search Console**: Propriedade validada. Sitemap submetido.

### [M2: ERROR TRACKING]
- Projetos React/TS complexos: Sentry configurado para capturar erros de runtime.
- Edge Functions: Logs nativos do Supabase monitorados.

### [M3: UPTIME]
- Domínios críticos monitorados por UptimeRobot ou BetterStack.
- Alerta via email ou webhook em caso de queda.

---

## PARTE VII — DEPLOY & CI/CD

### [D1: PIPELINE SOBERANO]
Todo projeto tem deploy automatizado. Deploy manual é hotfix emergencial e **deve ser documentado** no `HISTORICO_DE_DECISOES.md`.
- Preferir: GitHub Actions → Plataforma de host.
- Rollback: `git revert HEAD && git push` aciona novo deploy em < 60s.

### [D2: VARIÁVEIS DE AMBIENTE]
```
.env.example  → ✅ Commitado (mostra as variáveis, sem valores reais)
.env          → ❌ Nunca commitado
.env.local    → ❌ Nunca commitado
dist/         → ❌ Nunca commitado
*.zip         → ❌ Nunca commitado
```

---

## PARTE VIII — REDUNDÂNCIA COGNITIVA (Projetos com IA)

### [I1: FALLBACK CHAIN DE LLMS]
Nunca depender de um único provedor de LLM. Defina uma cadeia de fallback
própria do seu projeto — a ordem certa depende do seu mix de custo/latência/
qualidade, não existe "ordem universal". Exemplo de estrutura (preencha com
os provedores e modelos reais do seu projeto, revisando a cada troca de
modelo no mercado — provedores descontinuam modelos sem aviso):
```
Provedor A (mais barato/rápido) → Provedor B → Provedor C (mais caro, mais capaz)
```

### [I2: CUSTO SOBERANO]
Toda requisição a LLM loga: modelo, tokens in/out, custo estimado, latência.
Budget alert configurado por feature. Se custo ultrapassar threshold, sistema alerta antes de processar.

---

*PROTOCOLO_UNIVERSAL.md v2.0 | parte do Protocolo Serafim UM*
*Documento técnico — sem posicionamento de marca. Aplicável a todo tipo de projeto.*
