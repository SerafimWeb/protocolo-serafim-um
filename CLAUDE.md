# CLAUDE.md — {{NAME}}

> Lido automaticamente por Claude Code, Cursor e agentes compatíveis.
> É a lei do projeto para qualquer IA que trabalhe aqui. Não remova.
> Gerado pelo Protocolo Serafim UM em {{TODAY}}.

**Projeto:** {{NAME}} — {{PURPOSE}}
**Stack:** {{STACK}}

---

## PASSO ZERO — antes de qualquer ação, em toda sessão

1. Ler `{{MEM}}/IDENTITY.md` — o que é o projeto, stack, restrições.
2. Ler `{{MEM}}/ESTADO_ATUAL.md` — onde a última sessão parou.
3. Ler `{{MEM}}/DIAGNOSTICO.md` se existir — problemas que o doctor encontrou.
   **Se houver achado CRÍTICO ou ALTO:** antes de começar o que foi pedido,
   avise o usuário em uma frase ("antes da feature: tem X exposto, quer que
   eu corrija primeiro?"). Não corrija sem ele confirmar.
4. Se for mexer em deploy/CI: ler `{{MEM}}/DEPLOY.md` se existir.

---

## AS PERGUNTAS CERTAS — o que você verifica ANTES de agir

Quem pede pode não saber perguntar. Você pergunta por ele. Se o pedido
cair em um destes casos, cumpra a checagem sem esperar ser lembrado e,
quando o usuário pedir algo arriscado sem perceber, explique o risco em
uma frase e faça do jeito seguro.

**Criar ou alterar tabela no banco**
- RLS ligada + policy pra cada usuário acessar só o que é dele, usando
  `(select auth.uid())`. Tabela sem RLS = qualquer visitante lê tudo.
- Migration nova com script de volta (DOWN). Nunca editar migration já aplicada.

**Login, sessão, permissão**
- O id do usuário vem da sessão validada no servidor, nunca do body da requisição.
- Rota que exige login é checada no servidor, não só escondida na tela.

**Pagamento**
- Preço sempre vem do servidor/banco, nunca do navegador.
- Webhook com assinatura verificada; chave de idempotência estável (sem `Date.now()`).
- Testar com chaves de teste antes de qualquer chave live.

**Chaves, tokens, senhas**
- Só em `.env` (nunca no código), `.env` no `.gitignore`.
- Chave secreta NUNCA com prefixo público (`NEXT_PUBLIC_`, `VITE_`) — esse
  prefixo manda o valor pro navegador de qualquer visitante.
- Se o usuário colar uma chave no chat, avise que ela deve ser trocada.

**Chamar uma IA (OpenAI, Claude, Gemini...) dentro do app**
- Sempre pelo backend, nunca direto do navegador.
- Nome do modelo em variável de ambiente (modelos são descontinuados).
- Limite de uso por usuário — senão um visitante gasta seus créditos.

**Dado pessoal (nome, e-mail, CPF, localização)**
- Coletar só o necessário, nunca em log, nunca exposto entre usuários (LGPD).

**Apagar, sobrescrever, migrar dado ou arquivo**
- Confirmar com o usuário antes. Garantir que há como voltar (git, backup).

**Antes de dizer "pronto" / antes de deploy**
- Build e typecheck passando.
- `npx protocolo-serafim-um-setup doctor` sem achado CRÍTICO novo.
- Testar como o usuário real usaria (logado, com o papel dele), não só como anônimo.

---

## REGRAS ABSOLUTAS

- TypeScript strict, zero `any`. Todo input externo validado (Zod) na entrada.
- Sem secrets no código. Sem arquivos duplicados (`_v2`, `_bkp`, `_old`) — versionar é função do git.
- Todo `await` com tratamento de erro. Acesso a dado externo com `?.`.
- Bundle < 500KB gzip, LCP < 2.5s — se passar, registre o porquê.

## ARQUITETURA

```
UI     → componentes puros, sem regra de negócio
Lógica → hooks e services, testáveis isoladamente
Infra  → clientes externos (banco, pagamento, e-mail, IA)
```

---

## ENCERRAMENTO DE SESSÃO

- [ ] `{{MEM}}/ESTADO_ATUAL.md` atualizado — curto (< 100 linhas). Histórico vai para `{{MEM}}/HISTORICO_DE_DECISOES.md`.
- [ ] Decisão relevante registrada no `HISTORICO_DE_DECISOES.md` (entrada nova no topo).
- [ ] Nenhum secret exposto. Build passa.
- [ ] Rodar `npx protocolo-serafim-um-setup doctor` e mencionar a nota ao usuário.
