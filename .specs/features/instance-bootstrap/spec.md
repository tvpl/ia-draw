# Bootstrap de instância Specification

## Problem Statement

Uma instância recém-subida não tem como criar o primeiro usuário. Não existe rota de cadastro, CLI
nem seed: `createLocalAccount` (`apps/server/src/modules/auth/accounts.ts`) só é chamado por testes
e pelo harness e2e. Depois de `make up` numa máquina limpa, a pessoa recebe uma tela de login e
nenhuma conta com que entrar — a única saída documentável hoje é `make shell-postgres` e inserir um
hash à mão. O README promete um Quick start que termina em `http://localhost:8080` sem mencionar
esse abismo.

## Goals

- [ ] Uma instância nova permite criar o primeiro administrador pela interface, sem acesso ao banco
- [ ] A superfície de criação desaparece assim que a instância deixa de estar vazia
- [ ] Duas tentativas simultâneas nunca produzem duas instâncias "primeiras"

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Cadastro aberto de usuários | O produto é self-hosted com convite por workspace; abrir cadastro é decisão de produto separada |
| Convite por e-mail com envio de mensagem | Não há transporte de e-mail no projeto; `rbac-clarity` cobre o convite por lookup de conta existente |
| Recuperação de senha | Mesma razão: exige transporte de e-mail |
| Provisionar o primeiro admin por variável de ambiente | Descartado na discussão: mantém segredo em variável persistida e duplica o caminho de criação |
| Configurar o provider de IA durante o first-run | O `ai-provider` já tem sua própria tela; empilhar aqui aumenta a superfície da rota pública |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Condição de disponibilidade | A tabela `users` estar vazia | É o único predicado que não depende de configuração e não pode ser burlado por parâmetro |  y |
| Como a corrida é resolvida | Uma transação que insere o usuário sob um predicado de contagem zero, apoiada por constraint de unicidade; o perdedor recebe 409 | A guarda tem de ser do banco, não da aplicação — dois processos `apps/server` podem atender as duas requisições |  y |
| Resposta quando indisponível | `404` em ambas as rotas | Um `403` confirmaria que a rota existe e que a instância já foi inicializada; `404` não vaza estado |  y |
| O que o first-run cria | Conta local, organização, workspace inicial e associação `org_admin` | Sem organização e workspace o admin entra num produto vazio sem poder criar nada |  y |
| Política de senha | Mínimo de 12 caracteres, sem outras regras de composição | Comprimento é o único requisito com efeito real; regras de composição empurram para senhas piores |  y |
| Limite de tentativas | Mesmo limitador por IP já usado nas rotas de auth | Reusar o limitador existente evita um segundo mecanismo com comportamento sutilmente diferente |  y |
| Nome do workspace inicial | Informado pela pessoa no formulário, com um default pré-preenchido | Renomear depois é possível, mas pedir uma vez custa um campo e evita um workspace chamado "default" para sempre |  y |
| Sessão após o first-run | Abre sessão imediatamente, como um login bem-sucedido | Obrigar a autenticar logo após criar a própria conta é atrito sem ganho de segurança |  y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Primeiro acesso a uma instância nova ⭐ MVP

**User Story**: Como pessoa que acabou de subir a instância, quero criar o administrador inicial
pela própria interface, para começar a usar sem tocar no banco.

**Why P1**: Sem isso, o produto instalado é inacessível.

**Acceptance Criteria**:

1. WHILE a instância não tem nenhuma conta de usuário the sistema SHALL responder `GET /auth/first-run` com `{ "available": true }`
2. WHILE a instância tem ao menos uma conta de usuário the sistema SHALL responder `GET /auth/first-run` com `404`
3. WHEN `POST /auth/first-run` recebe e-mail, senha e nome de workspace válidos e a instância não tem nenhuma conta THEN o sistema SHALL criar a conta, uma organização, um workspace e uma associação de papel `org_admin`, abrir sessão e responder `201`
4. WHILE a instância tem ao menos uma conta de usuário the sistema SHALL responder `POST /auth/first-run` com `404` sem tocar no banco
5. IF a senha informada tem menos de 12 caracteres THEN o sistema SHALL responder `400` nomeando o campo, sem criar nada
6. IF o e-mail informado não é um endereço válido THEN o sistema SHALL responder `400` nomeando o campo, sem criar nada
7. WHEN o first-run conclui com sucesso THEN o sistema SHALL registrar um evento de auditoria `instance.bootstrapped` com o id da conta criada

**Independent Test**: subir a instância vazia, abrir a raiz, criar o admin pelo formulário e chegar
autenticado à lista de workspaces com um workspace já existente.

---

### P1: A porta se fecha sozinha ⭐ MVP

**User Story**: Como responsável pela instância, quero que a criação do primeiro admin deixe de
existir assim que ela for usada, para que ninguém crie um segundo administrador por essa via.

**Why P1**: É a única coisa que separa esta rota pública de um cadastro aberto.

**Acceptance Criteria**:

1. IF duas requisições `POST /auth/first-run` chegam simultaneamente a uma instância vazia THEN o sistema SHALL concluir exatamente uma com `201` e responder à outra com `409`, deixando exatamente uma conta criada
2. WHEN o número de tentativas de `POST /auth/first-run` de um mesmo IP excede o limite configurado THEN o sistema SHALL responder `429`
3. The rota de first-run SHALL ser registrada fora de qualquer verificação de sessão e SHALL nunca aceitar um papel informado pelo cliente
4. WHEN uma conta é criada por qualquer outro caminho THEN o sistema SHALL passar a responder `404` ao first-run sem exigir reinício

**Independent Test**: disparar duas requisições concorrentes contra uma instância vazia e confirmar
uma conta criada, uma `201` e uma `409`.

---

### P2: A tela de primeiro acesso

**User Story**: Como pessoa no primeiro acesso, quero um formulário claro em vez da tela de login,
para saber que preciso criar a conta inicial.

**Why P2**: A rota basta para desbloquear via API; a tela é o que torna o Quick start honesto.

**Acceptance Criteria**:

1. WHILE o first-run está disponível the rota `/login` SHALL renderizar o formulário de primeiro acesso em vez do formulário de credenciais
2. WHEN o formulário de primeiro acesso é enviado com sucesso THEN o sistema SHALL navegar para a raiz autenticada
3. IF o envio do formulário falha com `400` THEN o sistema SHALL exibir a mensagem do campo recusado e preservar os demais valores digitados
4. IF o envio do formulário falha com `409` ou `404` THEN o sistema SHALL exibir o formulário de credenciais, porque a instância deixou de estar vazia
5. The formulário de primeiro acesso SHALL ter todo o seu texto vindo do i18n em `en` e `pt-BR`

**Independent Test**: abrir a instância vazia e ver o formulário de primeiro acesso; recarregar
depois de criar e ver o formulário de login.

---

## Edge Cases

- IF a consulta de contagem de contas falha THEN o sistema SHALL responder `503` e não criar nada
- WHEN o e-mail informado tem letras maiúsculas THEN o sistema SHALL normalizá-lo antes de gravar, para casar com o login posterior
- IF o nome de workspace informado está vazio THEN o sistema SHALL responder `400` nomeando o campo
- WHEN o first-run roda numa instância cujo schema não foi migrado THEN o sistema SHALL falhar com erro do banco, nunca criar parcialmente
- IF a criação falha depois de inserir a conta THEN o sistema SHALL reverter a transação inteira, deixando a instância novamente vazia e o first-run disponível

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| BOOT-01 | P1: Primeiro acesso a uma instância nova | Implementing | Implementing (T2) |
| BOOT-02 | P1: Primeiro acesso a uma instância nova | Implementing | Implementing (T2) |
| BOOT-03 | P1: Primeiro acesso a uma instância nova | Implementing | Implementing (T1) |
| BOOT-04 | P1: Primeiro acesso a uma instância nova | Implementing | Implementing (T2) |
| BOOT-05 | P1: Primeiro acesso a uma instância nova | Implementing | Implementing (T2) |
| BOOT-06 | P1: Primeiro acesso a uma instância nova | Implementing | Implementing (T2) |
| BOOT-07 | P1: Primeiro acesso a uma instância nova | Implementing | Implementing (T1) |
| BOOT-08 | P1: A porta se fecha sozinha | Implementing | Implementing (T1) |
| BOOT-09 | P1: A porta se fecha sozinha | Implementing | Implementing (T2) |
| BOOT-10 | P1: A porta se fecha sozinha | Implementing | Implementing (T2) |
| BOOT-11 | P1: A porta se fecha sozinha | Implementing | Implementing (T4) |
| BOOT-12 | P2: A tela de primeiro acesso | Tasks | Pending |
| BOOT-13 | P2: A tela de primeiro acesso | Tasks | Pending |
| BOOT-14 | P2: A tela de primeiro acesso | Tasks | Pending |
| BOOT-15 | P2: A tela de primeiro acesso | Tasks | Pending |
| BOOT-16 | P2: A tela de primeiro acesso | Tasks | Pending |

**Coverage:** 16 total, 16 mapeados para tasks, 0 sem mapeamento.

---

## Success Criteria

- [ ] `make up` numa máquina limpa leva a uma sessão autenticada sem tocar no banco
- [ ] Duas requisições concorrentes de first-run produzem exatamente uma conta
- [ ] Depois do first-run, ambas as rotas respondem `404`
