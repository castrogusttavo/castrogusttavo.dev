---
title: De qualquer conta a admin da plataforma em três requisições
description: "O endpoint de editar perfil da Nexo aceitava um e-mail novo e gravava direto na linha, mantendo o e-mail como verificado. A lista de admins da plataforma é por e-mail. Qualquer usuário logado podia virar admin em três requisições, e a 2FA exigida no dia anterior não segurava nada, porque o atacante é dono da conta. Isto é o postmortem: como foi achado, por que o portão estava certo e mesmo assim falhou, o que mudou e o que ainda não foi verificado."
icon: bug
date: "2026-12-01"
---

Na noite de 27/09, esta sequência funcionava contra um build de produção
da Nexo, partindo de uma conta comum, recém-criada, sem nenhum papel
especial:

```
PATCH /api/users/me {"email":"<endereço da allowlist>"}  -> 200
POST  /api/auth/two-factor/enable {...}                  -> 200
GET   /api/admin/careers                                 -> 200, dados do admin
```

Três requisições, nenhuma verificação no caminho, e o resultado é acesso
de admin da plataforma: publicar vagas públicas no site e ler os dados
dos candidatos. A correção é o commit `f9053ab0`, no ar na mesma noite.

## O problema: o portão confiava num campo que o usuário podia escrever

A área de admin da plataforma não usa o RBAC de workspace. Ela é
autorizada por uma allowlist de e-mails numa variável de ambiente,
`PLATFORM_ADMIN_EMAILS`. O portão, em `resolvePlatformAdmin()`, fazia a
pergunta certa:

```ts
const email = user.email?.toLowerCase()
if (!email || !getPlatformAdminEmails().includes(email)) {
  return err(forbidden())
}
```

O defeito estava em outro arquivo. O `UpdateUserSchema`, que valida o
corpo do `PATCH /api/users/me`, tinha um campo `email` desde fevereiro. O
service conferia só se outra conta já usava aquele endereço e, se não,
repassava o DTO inteiro para o repository:

```ts
const updateResult = await UserRepository.update(actorId, dto)
```

O e-mail mudava. O `emailVerified` continuava `true`, herdado do endereço
antigo. A conta passava a ter, com selo de verificada, um endereço que
nunca provou possuir. E o portão de admin pergunta exatamente isso: qual
é o seu e-mail?

### Por que a 2FA não ajudou

No dia anterior (`c1585aaf`), eu tinha passado a exigir segundo fator para
a área de admin. O motivo era real: só estar na allowlist significava que
uma senha vazada abria tudo. Só que a 2FA protege contra quem roubou a
conta de outra pessoa. Aqui o atacante é o dono da conta. Ele liga a 2FA
na própria conta, com o próprio celular, e passa. A exigência nova
transformou um caminho de duas requisições num de três.

### As pré-condições

O ataque só funciona se o endereço da allowlist **não estiver registrado**
na Nexo, porque o service recusava trocar para um e-mail que outra conta
já usa. No momento em que foi achado, o endereço estava registrado, e
o caminho estava fechado em produção por esse motivo. Mas bastaria uma de
duas coisas para abri-lo:

- a conta do admin ser excluída (o que, depois do
  [conserto da exclusão de conta](/pt/writing/account-deletion-that-never-deleted),
  de fato acontece);
- eu adicionar um segundo endereço à allowlist antes de alguém criar a
  conta com ele.

A segunda é a operação normal de dar acesso a uma pessoa nova. O fluxo
natural de administração do produto abria a porta.

## Como foi achado

Não foi um scanner. Naquela noite eu não conseguia entrar no `/admin`. A
causa eram dois defeitos sem relação com segurança (`74945d20`): `/admin`
não tinha página nenhuma, só as subrotas, e o portão de 2FA lia
`twoFactorEnabled` da sessão, que o better-auth serve de um cache em
cookie por cinco minutos. Quem tinha acabado de ligar a 2FA era mandado
ligar a 2FA.

Enquanto isso era corrigido, pedi ao agente que estava trabalhando comigo
que tentasse todas as formas de entrar no admin sem ser admin. Ele subiu um
build de produção contra Postgres e Redis descartáveis e atacou com
quatro perfis: anônimo, usuário comum logado, admin da allowlist sem 2FA
e admin com 2FA, como controle. A maior parte resistiu: anônimo é
redirecionado ou recebe 401, usuário fora da allowlist recebe 403 na API
e não vê nenhuma página de admin, cookie adulterado não passa, variações de caixa e de
barra no caminho não mudam nada. O caminho do e-mail não resistiu, e foi
reproduzido de ponta a ponta antes de qualquer correção.

## A ideia: identidade não é campo de perfil

Nome, username e capa são perfil. E-mail é identidade, e numa plataforma
com allowlist por e-mail, identidade é autorização. Um endpoint de perfil
não deveria conseguir escrever nenhum dos dois últimos.

Isso é o velho *mass assignment*: o service recebe um objeto e grava o
objeto, então qualquer chave que o schema deixe passar vira coluna
alterada. O Zod, por padrão, descarta chaves desconhecidas, o que dá a
sensação de que o schema já resolve o problema. Só que o `email` não era
desconhecido. Ele estava no schema, de propósito, desde a primeira versão
do endpoint.

## Como funciona a correção

Quatro mudanças, cada uma fechando a porta por um lado diferente.

**O campo saiu do schema.** O `UpdateUserSchema` não tem mais `email`, e
o comentário no lugar dele explica por quê. Um `email` no corpo agora é
descartado antes de chegar ao service, sem erro: um endereço malformado
não é mais um erro para reportar, e o de outra pessoa não é mais um
conflito para revelar.

**O service escreve os campos pelo nome.** Em vez de repassar o DTO:

```ts
const updateResult = await UserRepository.update(actorId, {
  ...(dto.name !== undefined ? { name: dto.name } : {}),
  ...(dto.username !== undefined ? { username: dto.username } : {}),
  ...(dto.coverImage !== undefined ? { coverImage: dto.coverImage } : {}),
})
```

É a segunda tranca na mesma porta. Se alguém devolver um campo de
identidade ao schema no futuro, o service não grava, porque não sabe que
ele existe.

**O portão exige endereço verificado.**

```ts
if (!user.emailVerified) return err(forbidden())
```

Hoje isso é redundante: o login já exige e-mail verificado, e o ataque
passava justamente porque o flag ficava `true`. A redundância é o
objetivo. É a checagem que continua valendo se alguém, um dia, afrouxar a
exigência do login.

**Trocar e-mail passa a ser um fluxo, não um campo.** Um endereço novo só
deveria valer depois que uma mensagem enviada a ele for confirmada. Esse
fluxo ainda não existe. Hoje, na Nexo, não dá para trocar o e-mail da
conta.

Os testes que entraram refazem o ataque. Um e2e manda o endereço da
allowlist no `PATCH` e exige que o e-mail da conta continue o mesmo;
outro manda o mesmo `PATCH` e depois pede `/api/admin/careers`, exigindo
**403**. Os testes de schema e de service conferem que o campo é
descartado nas duas camadas.

O commit é das 21:51 de 27/09. A correção estava no ar às 22:31 do mesmo
dia.

## O resto da semana do admin

Esse bug apareceu no fim de dois dias mexendo na superfície de admin, e o
contexto importa, porque quase tudo ali foi endurecimento do segundo
fator:

| Commit | O quê |
| --- | --- |
| `05883c7e` (26/09) | app autenticador (TOTP) com códigos de backup, além do código por e-mail. Os OTPs passaram a ser guardados com hash: o default do plugin guardava o segundo fator vivo em texto claro na tabela de verificação. Bloqueio depois de **5** verificações erradas, não 10, por 15 minutos. "Confiar neste dispositivo por 30 dias" é recusado para admin num hook depois do login, porque a página de login não pode saber quem é admin sem que alguém conte a ela, e contar vazaria a lista |
| `8c0aa508` (26/09) | o bloqueio do better-auth escrevia em colunas que o schema não tinha; como o reset roda no caminho de **sucesso**, um código certo falhava o login igual a um errado |
| `c1585aaf` (26/09) | admin exige segundo fator; quem está fora da allowlist recebe `notFound()` em vez de redirect, porque um redirect confirma que a rota existe |
| `74945d20` (27/09) | o portão passa a morar só em `resolvePlatformAdmin()`; sessão que diz "sem 2FA" é conferida no banco antes de recusar |
| `2e349d83` (27/09) | `/admin` sai do `robots.txt`, que anunciava para todo mundo o caminho que a aplicação esconde com 404 |
| `4bace6de` (27/09) | o login para de mandar código por e-mail antes de saber se ele é necessário; para admin com app autenticador verificado, o fator por e-mail é recusado no servidor |

O último merece uma linha a mais. O better-auth aceita um código enviado
por e-mail para qualquer conta com 2FA ligada, seja qual for o fator
cadastrado, porque o `send-otp` só pede um desafio em andamento. Enquanto
um código puder ser enviado por e-mail, a caixa de entrada basta para
entrar, que é exatamente o que o app autenticador deveria resolver.

## O que isso diz sobre a autorização em três camadas

No post sobre [autorização em três camadas](/pt/writing/three-layer-authorization),
defendi que a decisão de "pode ou não pode" mora num lugar só, e que isso
torna a autorização auditável. Esse bug não contradiz isso. O portão
estava certo, no lugar certo, perguntando a coisa certa. A auditoria
encontrou o problema exatamente porque o portão era um só e dava para
atacá-lo de frente.

O que falhou foi uma premissa que o modelo nunca escreveu: que os
atributos em que a decisão se apoia não são graváveis por quem está
sendo autorizado. `Membership.role` muda por um service que exige
`OWNER` ou `ADMIN`. O e-mail mudava por um endpoint que exigia só estar
logado. Centralizar a decisão não protege nada se o dado que ela lê pode
ser escrito por outro caminho.

## Onde quebrou

**A janela em produção existiu.** A allowlist entrou no ar em 26/09, às
13:43 (-03), quando a sincronização das variáveis de ambiente pôs
`PLATFORM_ADMIN_EMAILS` em produção, cerca de 18 minutos antes do CD;
antes disso, a área de admin não abria para ninguém. A janela fechou em
27/09, às 21:09, quando registrei a conta com o endereço da allowlist:
como o campo é único, o endereço passou a estar ocupado e a troca passou
a ser recusada. Foram **~31h26** com as pré-condições satisfeitas em
produção. A correção em si só entrou no ar às 22:31.

O que consegui verificar sobre essa janela:

- registrei o endereço da allowlist sem conflito, ou seja, naquele
  momento nenhuma conta usava aquele e-mail;
- só uma conta na Nexo tem 2FA ligada, a minha, e o caminho até o admin
  passa por ligar a 2FA;
- a tabela `career_jobs` está vazia: nenhuma vaga foi criada, por
  ninguém;
- os logs do nginx guardam só 14 dias e já não cobrem a janela.

E o Axiom, que guarda os logs da aplicação por mais tempo que o nginx,
ainda cobria a janela. Busquei duas coisas nela: toda auditoria de
`user.update` que mexeu em `email`, e toda requisição a `/admin`,
`/api/admin` e `/api/auth/two-factor/`. Apareceram cinco tentativas de
trocar e-mail e centenas de chamadas às rotas de admin, quase todas
vindas de `127.0.0.1`, em rajadas de um minuto com cara de suíte de
teste. Agrupando essas por host, as **3.755** são de `localhost:3000`: a
minha máquina, rodando os testes e2e e a auditoria daquela noite, que
logam no mesmo dataset da produção. As cinco trocas de e-mail caem nos
mesmos minutos dessas rajadas. Fora delas, sobram a ativação da minha 2FA
às 21:12 de 27/09, vinda do meu IP, e robôs atrás de `/admin.php`,
`/adminer.php` e parentes, caminhos que não existem num app Next.

**O defeito estava anotado, com o nome errado.** Nas minhas notas de
arquitetura, desde maio, havia um item de revisão pendente: "hoje
`PATCH /api/users/me { email }` mantém `emailVerified=true`". Estava
classificado como correção de fluxo de conta. Em julho, a allowlist de
admin entrou, e o e-mail virou atributo de autorização. Ninguém voltou
na nota. A causa raiz não é falta de conhecimento do defeito; é que uma
mudança de modelo de autorização não disparou uma revisão dos campos de
que ela passou a depender.

**Não varri os outros DTOs.** O service de usuário agora escreve campo a
campo, mas **10 outros services** ainda repassam o DTO inteiro para o
repository (projeto, workspace, labels, estados, vagas, entre outros). A
proteção ali é a mesma de antes do bug: o schema. Olhei um caso, o
`leadId` do projeto, que é atributo de autorização e é validado contra a
lista de membros antes de gravar. Não auditei os outros campo a campo.

**A allowlist por e-mail é o desenho frágil, e continua.** Um endereço é
um atributo que muda, que pode ser liberado e reaproveitado. Uma lista de
ids de usuário, ou uma coluna de papel que só um admin escreve, não teria
esse problema. Mantive o e-mail porque a correção fechou o caminho
conhecido e o custo de migrar é maior que o tamanho da superfície hoje.
É uma escolha, e ela depende de nenhum outro caminho conseguir escrever o
e-mail, o que é exatamente a premissa que falhou desta vez.

**O título da página entregava a área.** Na auditoria, parecia que o
shell prerenderizado mandava o `<title>` das páginas de admin para um
usuário logado fora da allowlist: o 404 esconderia o conteúdo, mas não a
existência da rota. Era plausível, mas não cheguei a reproduzir. Nenhum
dado vazaria por ali, e mesmo assim corrigi em
[`d321d876`](https://github.com/castrogusttavo/nexo/commit/d321d876): os títulos passaram a ser decididos atrás do portão
de admin, via `adminMetadata`, com um teste e2e cobrindo.

## O que isso prova, e o que não prova

Prova que o caminho do e-mail até o admin está fechado em três camadas
independentes (schema, service e portão), que existe teste e2e que refaz
o ataque e exige 403, e que a correção foi para produção na mesma noite
em que o problema foi reproduzido. Prova que um portão de autorização
correto não basta quando o dado que ele lê é gravável por outro
endpoint.

Não prova com certeza absoluta que ninguém usou a janela: o Axiom mostra
que o tráfego às rotas de admin naquelas 31 horas era meu ou de robôs, mas
só as requisições que chegam à aplicação viram log, e os do nginx já
expiraram. E a busca só foi tão trabalhosa porque a minha máquina loga no
mesmo dataset da produção, um defeito de observabilidade que essa
investigação deixou à vista. Não prova que não há outro campo sensível sendo gravado
por mass assignment nos outros 10 services. E não prova que a allowlist
por e-mail é segura: prova só que, hoje, não conheço outro jeito de
escrever o e-mail de uma conta.
