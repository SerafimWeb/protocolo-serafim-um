# Protocolo Serafim UM

**Você programa com IA. A IA não pergunta o que você não sabe perguntar.**
Este pacote faz essas perguntas por você — e deixa sua IA preparada pra
fazê-las sozinha daqui pra frente.

```bash
npx protocolo-serafim-um-setup doctor
```

Em segundos, uma nota de 0 a 100 do seu projeto e, para cada problema:
o que é, por que importa, como corrigir e **uma pergunta pronta pra colar
na sua IA**. Sem enviar nada pra lugar nenhum, sem conta, sem cadastro.

O que o doctor procura — os erros que mais quebram (e mais custam) em
projetos feitos com IA:

- chave secreta no código, ou indo pro navegador (`NEXT_PUBLIC_`/`VITE_` em chave de IA, Stripe, service_role)
- SDK de IA chamado direto do navegador (`dangerouslyAllowBrowser`)
- `.env` commitado no git ou fora do `.gitignore`
- tabela do Supabase criada sem RLS (qualquer um lê os dados de todo mundo)
- modelo de IA descontinuado ainda no código, ou nome de modelo espalhado em vários arquivos
- memória da IA (`CLAUDE.md`, estado do projeto) grande demais pra ela ler inteira
- TypeScript sem strict, `any` demais, sem testes, sem CI, sem health check, `eval`, XSS

O valor de um segredo encontrado **nunca** é impresso — só o tipo e onde está.

## Instalar o protocolo no projeto

```bash
npx protocolo-serafim-um-setup
```

Detecta sua stack e onde você publica — só pergunta o que não dá pra
descobrir. Em um minuto:

- **`CLAUDE.md` com "as perguntas certas"**: antes de criar tabela, mexer em
  login, pagamento, chaves ou chamar uma IA, sua IA cumpre uma checagem
  obrigatória — sem você precisar saber pedir. Lido por Claude Code e Cursor.
- **Memória do projeto** (`.seuprojeto/`): identidade, estado atual, roadmap
  e histórico de decisões — a IA começa cada sessão sabendo onde parou.
- **Diagnóstico pra IA**: o resultado do doctor vai pra
  `.seuprojeto/DIAGNOSTICO.md`, e a IA avisa sozinha se houver algo crítico
  antes de começar a próxima tarefa.
- **Deploy e health check gerados** pela stack detectada (Vercel, Netlify,
  Railway ou Hostinger/FTP; Next.js, Express ou Supabase Edge Function) e
  `.env.example` com o prefixo público certo pro seu framework.
- **Git hook** que lembra de atualizar o estado do projeto.

Nunca sobrescreve: se você já tem `CLAUDE.md`, memória ou workflow de
deploy, eles ficam intactos e a sugestão vai ao lado.

Também funciona sem interação (CI, scripts, ou outra IA respondendo): as
respostas podem vir por pipe, uma por linha.

```bash
npx protocolo-serafim-um-setup --check   # tem versão nova?
```

## Versão completa (paga)

- **Watchdog** (Shift+D, só em desenvolvimento): o diagnóstico do doctor
  dentro do app, com botão "copiar pergunta pra IA", saúde dos endpoints e
  o mapa real da arquitetura. Instalado e montado sozinho.
- **Enforcement pack**: ESLint, gitleaks e CI que fazem as regras quebrarem
  o build — configurados automaticamente no formato do seu projeto.
- **Skills reais pro Claude Code**: AI Red Team, 5-Why Debug, Test-as-You-Build.
- Os 7 módulos de auditoria, o MCP Arsenal, o checklist de 47 itens e o
  documento completo: 17 regras absolutas e 23 skills, cada uma com o
  incidente real que a originou.

**https://serafimweb.com/serafim13/protocolo-um**

## Licença

MIT para o código deste pacote (ver `LICENSE`). O nome "Serafim" e a marca
associada não são cobertos por esta licença.
