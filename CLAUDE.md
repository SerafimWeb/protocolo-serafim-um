# CLAUDE.md — Protocolo de Operação do Projeto

> Este arquivo é lido automaticamente por Claude Code, Cursor e agentes compatíveis.
> Ele ativa o Protocolo de Engenharia ao abrir este diretório.
> NÃO remova este arquivo. Ele é a lei do projeto para qualquer IA que trabalhe aqui.

---

## CONFIGURAÇÃO — LEIA ISTO PRIMEIRO

**Quando você copiou este template, deve ter renomeado a pasta `.memory/` para o nome do seu projeto.**
Se ainda não fez, faça agora:
```bash
mv .memory .nomedoseuprojeto   # ex: .argus, .vidgi, .meuapp
```
Depois atualize todas as referências a `.memory/` neste arquivo para o nome que você escolheu.
Um `Ctrl+H` resolve.

---

## PASSO ZERO — OBRIGATÓRIO ANTES DE QUALQUER AÇÃO

**Toda sessão começa assim, sem exceção:**

1. Ler `.memory/IDENTITY.md` — quem é este projeto, qual é o stack, quais são as restrições
2. Ler `.memory/ESTADO_ATUAL.md` — onde a última sessão parou e o que vem a seguir
3. Ler `.memory/ROADMAP.md` — visão macro do projeto
4. **Se for tocar em CI/CD, deploy, infraestrutura ou scripts de build:** Ler `.memory/DEPLOY.md` — caminhos, secrets, histórico de falhas. Este arquivo existe porque ignorar essa leitura causou 48h de downtime por um caminho hardcoded errado.

Somente então iniciar o trabalho solicitado.

**Ignorar esta sequência é uma violação de protocolo.** O trabalho feito sem contexto vai na direção errada — frequentemente na direção de decisões que já foram tomadas e documentadas.

---

## IDENTIDADE DO PROJETO

*(Preenchido automaticamente a partir do IDENTITY.md — esta seção é um lembrete)*

O contexto completo está em `.memory/IDENTITY.md`. Leia antes de agir.

---

## REGRAS ABSOLUTAS DE ENGENHARIA

**[R1] TypeScript Strict.**
Zero `any` implícito. Todo input externo validado com Zod antes de processar.

**[R2] Sem secrets no código.**
Nenhuma chave, token ou senha toca um arquivo versionado. Variáveis de ambiente em `.env` local, nunca commitadas.

**[R3] Sem arquivos duplicados.**
Proibido criar `arquivo_v2.tsx`, `component_bkp.ts`, `index_old.html`. Versionar é função do Git.

**[R4] RLS em tabelas com dados de usuário.**
Se o projeto usa Supabase ou similar, toda tabela com dados de usuário tem Row Level Security ativa.

**[R5] Nenhuma migration sem script DOWN.**
Toda mudança de banco tem rollback documentado.

**[R6] Performance Budget.**
Bundle gzipped < 500KB. LCP < 2.5s. Se ultrapassar, documentar a justificativa.

**[R7] Código defensivo.**
Todo `await` tem tratamento de erro. Nenhum acesso a propriedade de objeto externo sem `?.` ou verificação explícita.

---

## PADRÕES DE ARQUITETURA

```
UI         → Componentes puros. Zero lógica de negócio.
Lógica     → Hooks e services. Testáveis de forma isolada.
Infra      → Clientes externos (supabase, stripe, etc.).
```

**Proibido:** Componente que faz fetch, valida, formata e renderiza tudo junto.

**Proibido:** Lógica de negócio em arquivo de rota ou página.

**Organização de pastas:**
```
src/
├── components/   ← UI reutilizável
├── features/     ← Domínio específico (agrupado por feature)
├── lib/          ← Integrações externas
└── types/        ← Tipos compartilhados
```

---

## ENCERRAMENTO DE SESSÃO — CHECKLIST OBRIGATÓRIO

Ao encerrar cada sessão de trabalho:

- [ ] `.memory/ESTADO_ATUAL.md` reflete o estado real pós-sessão?
- [ ] `.memory/HISTORICO_DE_DECISOES.md` tem nova entrada no topo com decisões desta sessão?
- [ ] Nenhum secret foi exposto em arquivo versionado?
- [ ] Build passa sem erros? (`npm run build` ou equivalente)

---

## PARA DESENVOLVEDORES HUMANOS

O contexto do projeto está na pasta de memória. Leia nesta ordem:
1. `IDENTITY.md` — o que é e para quem
2. `ESTADO_ATUAL.md` — onde está agora
3. `ROADMAP.md` — para onde vai
4. `HISTORICO_DE_DECISOES.md` — por que está como está

Documente toda decisão relevante no histórico antes de encerrar.

---

*CLAUDE.md — Protocolo de Operação. Não remova. Não edite sem atualizar o HISTORICO_DE_DECISOES.md.*
