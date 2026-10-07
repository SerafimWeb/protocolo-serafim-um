# Protocolo Serafim UM — versão gratuita

Sistema de memória persistente para projetos que usam Claude Code, Cursor,
Windsurf ou qualquer agente de IA que leia arquivos do projeto. Resolve o
problema de toda sessão de IA começar do zero: a IA lê o contexto real do
projeto antes de agir, em vez de você re-explicar tudo.

## O que tem aqui (MIT, grátis)

- `CLAUDE.md` — lido automaticamente por Claude Code e Cursor. Define as
  regras de engenharia e manda a IA ler a pasta de memória antes de agir.
- `.memory/` — a pasta de memória: `IDENTITY.md`, `ESTADO_ATUAL.md`,
  `ROADMAP.md`, `HISTORICO_DE_DECISOES.md`, `PROTOCOLO_UNIVERSAL.md`.
- `hooks/pre-commit` — git hook que bloqueia o commit se você esqueceu de
  atualizar `ESTADO_ATUAL.md`.
- `setup.js` — instalador automático (60 segundos, 5 perguntas). Depois das
  perguntas, detecta sua stack pelo `package.json` do seu projeto e, sem
  perguntar de novo:
  - gera o workflow de deploy certo (Vercel, Netlify, Railway ou
    Hostinger/FTP) em `.github/workflows/deploy.yml`;
  - gera o health check certo pra sua stack (Next.js, Express ou Supabase
    Edge Function);
  - gera `.env.example` com as variáveis da stack detectada;
  - nunca sobrescreve um arquivo que já existe — se já houver um
    `deploy.yml`, salva a sugestão ao lado em vez de substituir.
- `check-version.js` — avisa quando sai uma versão nova.

## Instalar

```bash
npx protocolo-serafim-um-setup
```

## Checar se há versão nova

```bash
npx protocolo-serafim-um-setup --check
```

Compara sua versão instalada contra a publicada. Existe porque o próprio
ecossistema Serafim já teve cópias divergentes deste protocolo rodando sem
ninguém notar — isto evita que aconteça com o seu projeto.

Ou manualmente:

```bash
cp -r templates/.memory/* .memory/
cp templates/CLAUDE.md .
cp templates/hooks/pre-commit .git/hooks/
chmod +x .git/hooks/pre-commit
```

## O que NÃO tem aqui (pacote completo, pago)

- `WATCHDOG.tsx` — painel de saúde visual (Shift+D) com monitoramento de
  endpoints, interaction trail e mapa de arquitetura. No pacote completo,
  o mesmo `setup.js` tenta montar automaticamente em `src/main.tsx`.
- O enforcement pack — ESLint, gitleaks e CI que fazem as regras
  quebrarem o build de verdade, não só pedir educadamente.
- 3 skills reais no formato Claude Code (`SKILL.md`): AI Red Team,
  5-Why Debug, Test-as-You-Build.
- Os módulos de auditoria de projeto existente (7 prompts estruturados).
- O MCP Arsenal (Supabase, GitHub, Context7 para Claude Code/Cursor).
- O checklist de 47 itens do zero ao deploy profissional.
- O documento completo com as 17 regras absolutas e as 23 skills
  operacionais, cada uma com failure mode real documentado.

Pacote completo: **https://serafimweb.com/serafim13/protocolo-um**

## Licença

MIT para o código deste pacote (ver `LICENSE`). O nome "Serafim" e a marca
associada não são cobertos por esta licença.
