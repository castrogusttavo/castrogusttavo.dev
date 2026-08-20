---
title: Tudo que eu sei sobre bom design de API
description: Um artigo do Sean Goedecke sobre design de API cristalizou um instinto que eu já tinha construindo o backend da nexo — a diferença não está nas regras que você escolhe, está em onde elas realmente são seguidas e onde alguém admite que não são.
icon: code
date: "2026-08-19"
---

Tem uma frase no post do Sean Goedecke sobre design de API
([seangoedecke.com/good-api-design](https://www.seangoedecke.com/good-api-design/))
que nomeou um instinto que eu já tinha, mas nunca tinha conseguido colocar em
palavras: uma API publicada é quase uma promessa imutável — "we do not break
userspace". Ele lista uma dúzia de princípios em cima disso: versionamento
como mal necessário, chaves de API antes de OAuth pela acessibilidade,
paginação por cursor em vez de offset, idempotência pra qualquer operação que
muda estado. Concordo com quase todos.

Mas nenhum princípio isolado explica por que partes da API da nexo — o SaaS
que ajudo a construir — envelheceram bem, e outras não. A diferença nunca
esteve na regra escrita. Esteve em onde a regra foi realmente aplicada em
todo canto que precisava, e em onde alguém decidiu conscientemente que não
seria, e disse isso em voz alta.

## Um envelope, uma fonte de verdade, sem exceção por acidente

Toda rota de API da nexo devolve o mesmo formato: sucesso é
`{ success, statusCode, data }`, erro é `{ success, statusCode, message, error }`.
Não é uma convenção informal — é um union type
(`types/http-response.d.ts`) e duas funções (`successResponse`,
`errorResponse` em `utils/http-response.ts`) que são o único lugar do
código que constrói essas formas. Nenhum service ou repository lança
exceção entre camadas: eles devolvem `Result<T, AppError>`, e quem chama
propaga o erro adiante até a rota decidir o que fazer com ele.

O `AppError` em si vem de um registro central
(`src/errors/codes.ts`) que mapeia cada código de domínio pro status HTTP
certo. Isso devia ser prova contra bug — e quase é. Mas é um arquivo de
texto mantido à mão, e arquivo de texto mantido à mão dá bug:

```ts
// src/errors/codes.ts
ESTIMATE_SETTINGS_FORBIDDEN: {
  code: 'ESTIMATE_SETTINGS_NOT_FOUND', // devia ser 'ESTIMATE_SETTINGS_FORBIDDEN'
  status: 403,
},
```

Um cliente que toma 403 nessa rota recebe `error.code:
"ESTIMATE_SETTINGS_NOT_FOUND"` — o código errado, embora o status HTTP esteja
certo. Em outro ponto do mesmo arquivo, `MODULE_MEMBER_ALREADY_EXISTS` está
mapeado pra **405** (Method Not Allowed), quando todo outro "já existe" do
arquivo usa 409 (Conflict).

Isso não invalida centralizar a fonte de verdade — prova o oposto. O bug é
uma linha de diff pra corrigir, não uma caçada por 89 arquivos de rota
tentando lembrar onde cada erro é construído à mão. A arquitetura não
impede o erro; ela reduz o raio da explosão quando ele acontece. É essa a
métrica que importa, não "zero bugs no primeiro commit".

## Não versionamos, e isso não é preguiça

A nexo não tem `/v1/` em lugar nenhum. Zero rotas versionadas, spec do
OpenAPI fixa em `1.0.0`, projeto em desenvolvimento ativo, commit direto na
`main` sem branch de release. Pelo padrão do Goedecke — nunca quebrar o
contrato publicado — isso parece descuido. Não é.

Versionar uma API é prometer manter `/v1/` e `/v2/` rodando ao mesmo tempo,
pra sempre, pra usuários que talvez nem existam ainda. A nexo ainda não
pagou o custo de publicar um contrato pra um público amplo e desconhecido —
os consumidores da API hoje são o próprio frontend e um número pequeno e
identificável de integrações. Adicionar versionamento agora seria pagar a
complexidade de uma promessa que ninguém está cobrando ainda. O próprio
Goedecke faz essa distinção: API interna, com consumidores que você pode
coordenar diretamente, não precisa da mesma imutabilidade que uma API
pública com milhares de integrações desconhecidas. Não versionar não é a
ausência de uma decisão — é a decisão certa pro estágio em que o projeto
está, revisável no dia em que deixar de ser.

## Consistência não é regra escrita, é regra aplicada em todo lugar

A listagem de membros de workspace tem paginação de verdade, com limite de
página:

```ts
// src/schemas/member.schema.ts
page: z.coerce.number().int().min(1).default(1),
pageSize: z.coerce.number().int().min(1).max(100).default(20),
```

A listagem de issues de um projeto — que cresce sem limite natural, ao
contrário da lista de membros — não tem paginação nenhuma:

```ts
// src/repositories/issue.repository.ts
async listByProject(projectId: string): Promise<Result<IssueWithGroups[]>> {
  const issues = await prisma.issue.findMany({
    where: { projectId, deletedAt: null },
    orderBy: { number: 'asc' },
    include: issueWithGroupsInclude,
  })
  return ok(issues)
},
```

O padrão certo existe no código. Só não foi propagado pro lugar que mais
precisava dele. Isso é mais revelador do que se a nexo simplesmente não
soubesse paginar nada — mostra que "ter o padrão" e "ter a disciplina de
aplicar o padrão em todo canto" são duas coisas diferentes, e só a segunda
conta como consistência de verdade.

Vale uma nuance honesta aqui: mesmo a paginação de membros não segue o
conselho específico do Goedecke, que defende cursor em vez de offset —
offset obriga o banco a contar até a página pedida, o que degrada em
datasets grandes; cursor (`WHERE id > cursor`) não. A nexo usa offset com
limite fixo. No volume atual, isso não é um problema real. Se a lista de
issues um dia precisar de paginação — e ela vai precisar — a escolha
tecnicamente certa é cursor, não copiar o padrão de membros. Aplicar um
padrão em todo canto só é uma virtude quando o padrão ainda é o certo pro
problema.

## A exceção que sabe que é exceção

O webhook de pagamento (`app/api/payment/webhook/route.ts`) ignora o
envelope padrão de resposta por completo — devolve `{ error: '...' }` cru,
sem `success`, sem `statusCode` no formato de todo o resto da API:

```ts
// app/api/payment/webhook/route.ts
if (!result.ok) {
  // Status 500 achatado (não o mapeamento por código de erro de sempre) é
  // proposital aqui: o AbacatePay reenvia em 5xx, então uma falha
  // transitória de busca deve ser tentada de novo, não rejeitada como
  // permanente.
  return Response.json({ error: result.error.message }, { status: 500 })
}
```

Esse comentário é a diferença entre dívida técnica e decisão de design. O
provedor de pagamento reenvia o webhook em qualquer 5xx; um 500 achatado
aqui garante retry automático numa falha transitória, e um 4xx marcaria o
evento como rejeição permanente por engano. Alguém pensou nisso, escolheu
quebrar a regra de propósito, e deixou escrito por quê.

Compare com a checagem de sessão no edge (`proxy.ts`), que devolve seu
próprio 401 escrito à mão em vez de reusar `errorResponse`:

```ts
// proxy.ts
if (pathname.startsWith('/api/')) {
  return NextResponse.json(
    { success: false, statusCode: 401, error: { code: 'UNAUTHORIZED' } },
    { status: 401 },
  )
}
```

Essa resposta não tem o campo `message` que todo outro erro da API carrega.
Ninguém decidiu que essa rota merecia um formato diferente — ela só nasceu
antes ou fora do helper compartilhado, e ficou. Não tem comentário
explicando por quê, porque não tem porquê: é o mesmo tipo de quebra do
envelope que o webhook tem, só que sem a parte em que alguém assumiu a
responsabilidade por ela.

## O que isso significa

Nenhuma lista de princípios — nem a do Goedecke, nem a que eu escreveria do
zero — decide sozinha se uma API vai envelhecer bem. O que decide é se a
equipe segue a regra que escolheu em todo lugar onde ela precisa valer, e
se, nos lugares onde não segue, isso foi uma escolha registrada em vez de
uma rachadura silenciosa. A diferença entre o webhook da nexo e o 401 do
proxy não é qual dos dois quebra a convenção — os dois quebram. É que só um
deles sabe que quebra.

Bom design de API não é ter as regras certas no papel. É a disciplina de
aplicá-las em todo lugar que importa, e a honestidade de nomear, por
escrito, o único lugar em que você decidiu que não valia a pena.
