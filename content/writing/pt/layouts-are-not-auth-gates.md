---
title: Layout não é portão — o redirect que não impedia o resto da página de renderizar
description: "O portão de consentimento da Nexo morava num layout, com um comentário dizendo pra não removê-lo nem enfraquecê-lo. Ele redirecionava certo, e mesmo assim um membro sem consentimento recebia no payload RSC dado que só deveria ver depois de aceitar — na home do workspace, o id do workspace e o próprio id: no App Router, os layouts de um caminho renderizam em paralelo, e um redirect no de cima não cancela os de baixo. Este post é o vazamento, o helper de teste que escondia o caminho dele, a troca do portão por uma Data Access Layer ao lado do dado, e o que isso destravou: o app logado inteiro como prerender parcial."
icon: bug
date: "2026-11-03"
---

O layout raiz da parte privada da Nexo tinha este comentário em cima da
checagem de consentimento:

```tsx
// SECURITY GATE (STR-61 ) - do not remove or weaken.
// Every authenticated path under (private) requires accepted Terms + Policy.
const consent = await requireConsent(session.value.user.id, 'page:(private)')
if (!consent.ok) redirect('/onboarding/consent-setup')

return <>{children}</>
```

STR-61 é a regra que diz que ninguém vê nada do app antes de aceitar os
termos de uso e a política de privacidade — é a parte da LGPD que vira
código. E o portão funcionava, no sentido que dava pra ver: um membro sem
consentimento abria o workspace e o navegador ia parar em
`/onboarding/consent-setup`. Nenhum sintoma visível.

O que estava errado só apareceu quando eu escrevi um teste que não olha
pro navegador, olha pro corpo da resposta. Pra um membro sem
consentimento, o HTML de `/<slug>` tinha as duas coisas ao mesmo tempo
(ids trocados aqui):

```text
NEXT_REDIRECT;replace;/onboarding/consent-setup;307
["$","$L40b",null,{"workspaceId":"<id do workspace>","base":"/<slug>","userId":"<id do usuário>","isPrivileged":false}]
```

A primeira linha é o portão disparando. A segunda é o layout de baixo
renderizando mesmo assim e mandando props pro cliente.

## O problema: um layout não decide se o resto da rota renderiza

No App Router, os layouts e a página de um mesmo caminho **renderizam em
paralelo** — a documentação do Next 16 diz isso com essas palavras no guia
de busca de dados ("layouts and pages are rendered in parallel"), como
vantagem: cada segmento começa a buscar o seu dado o quanto antes. O
efeito colateral está no guia de autenticação, na seção "Layouts and auth
checks":

> A layout also does not control whether the rest of the route renders.
> Route segments and parallel route slots are rendered by the router, so a
> layout that hides or swaps them does not stop them from running or from
> appearing in the RSC Payload.

Ou seja: o `redirect()` do `(private)/layout.tsx` interrompia aquele
layout, não os irmãos dele. O `(home)/layout.tsx`, dois níveis abaixo,
resolvia sessão e membership por conta própria — sem checar
consentimento — e entregava `workspaceId`, `userId` e `isPrivileged` pro
`SidebarProjects`, um client component. Props de client component vão no
payload RSC. O redirect chegava junto com elas.

Pra medir o estrago: quem recebeu dados era membro daquele workspace,
nunca um estranho e nunca outro tenant. Visitantes anônimos e não membros
pararam nas checagens de sessão e de membership que cada página já fazia.
O que o membro recebia antes de consentir dependia da página. Na home do
workspace eram ids: o dele e o do workspace. Foi essa página que o teste
pegou.

Mas os contextos de projeto e a página de billing pulavam o consentimento
do mesmo jeito: uma página de projeto levaria o DTO do projeto (nome,
descrição e configurações), uma de issue o título da issue, e o billing o
plano, os seats e as datas do trial. Tudo dado que o membro vê depois de
aceitar. Nada disso deveria renderizar antes. E até o fix entrar, o proxy
não checava consentimento nenhum: era toda visita de um membro sem
consentimento, não um caso de borda. Em produção ficou teórico: quando
conferi, todo membro tinha aceitado os termos.

O código que mandava o `workspaceId` do `(home)/layout` está no repositório
desde 19 de junho; o `userId` entrou em 13 de outubro.

O comentário do layout, aliás, já pressentia o problema pelo lado errado.
Ele pedia pra não envolver o portão em `<Suspense>` "porque a página
renderizaria antes da checagem terminar". A página já renderizava.

## Por que nenhum teste pegou

A Nexo tem e2e de API há meses, e o portão de consentimento tinha teste.
O que nenhum teste fazia era mandar o cookie do jeito que um navegador
manda.

O helper `createAuthenticatedUser` devolvia o header `Set-Cookie` cru da
resposta de login e os testes o reenviavam como `Cookie`. Um `Set-Cookie`
cru junta vários cookies com `", "` e carrega atributos (`Path`,
`HttpOnly`, `Max-Age`). O servidor lia o `session_token` direito e dobrava
o resto num nome de atributo — incluindo o `better-auth.session_data`, o
cookie cache assinado do Better Auth. Todo e2e lia a sessão do banco, e
nenhum exercitava o caminho que dependia do cookie cache.

A correção foi o helper devolver também o header que um navegador
mandaria:

```ts
// The Cookie header a browser would send: name=value pairs only. `cookie`
// (the raw Set-Cookie header) joins cookies with ", " and keeps their
// attributes, so a server reads the session token and folds the rest into
// attribute names: better-auth's session cache never arrives with it.
function toCookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(';')[0])
    .join('; ')
}
```

E um `withoutSessionCache(browserCookie)` pra simular o outro caso: o
cookie cache ausente ou vencido, que é o estado normal a cada 5 minutos.

## A ideia: a checagem mora ao lado do dado

O mesmo guia do Next diz onde a checagem deve ficar: perto da fonte de
dados, numa Data Access Layer. Se toda função que lê dado do workspace
checa sessão, consentimento e membership antes de ler, não importa quantos
layouts renderizam em paralelo — nenhum deles consegue ler sem passar pela
checagem.

Isso divide o trabalho em dois papéis que antes estavam misturados no
layout:

- **Proxy, otimista.** Lê o cookie cache assinado, sem banco, e manda cedo
  pro passo de consentimento quem claramente não aceitou. É UX: evita
  renderizar uma página que vai ser redirecionada.
- **DAL, definitiva.** Roda em toda leitura, vai ao banco, e é a única
  que pode negar acesso de verdade.

E o layout deixa de ser portão. No [post sobre autorização em três
camadas](/pt/writing/three-layer-authorization) eu descrevi o proxy como edge gate
que só verifica presença de cookie, e a decisão real no service. O que
este bug mostrou é que existia uma quarta "camada" informal — o layout —
em que a renderização confiava e que não segurava nada.

## Como funciona

### A DAL

`src/lib/dal.ts` tem três funções: `getCurrentUser`,
`requireConsentedUser` e `requireMembership`. As três são
`'use cache: private'`:

```ts
export async function requireMembership(
  slug: string,
): Promise<{ user: CurrentUser; membership: MembershipDTO }> {
  'use cache: private'
  cacheLife(SHELL_STALE) // { stale: 300 }

  const user = await readUser()
  const consent = await requireConsent(user.id, `page:workspace:${slug}`)
  if (!consent.ok) redirect('/onboarding/consent-setup')

  const membership = await MembershipService.getByUserAndSlug(user.id, slug)
  if (membership.ok && membership.value) {
    return { user, membership: membership.value }
  }
  // ...onboarding, /create-workspace ou notFound()
}
```

`use cache: private` não guarda nada no servidor: a função roda de novo a
cada request. Quem guarda o resultado é o roteador do navegador, pelo
`stale` configurado. E o `stale` de 300 segundos não é arbitrário: a
documentação do Next exige pelo menos 30 segundos pra prefetch por link
funcionar e **pelo menos 5 minutos** pro conteúdo entrar no App Shell da
rota. É esse número que transforma a checagem de acesso em algo
compatível com navegação instantânea.

Considerei cachear a membership no servidor também e não fiz. Hoje não
existe remoção nem troca de papel de membro na Nexo, e um cache de
servidor que alguém esqueça de invalidar quando isso existir manteria
acesso de quem foi removido. A checagem ir ao banco toda vez é o preço.

Com a DAL no lugar, o `(home)/layout` virou:

```tsx
const { user, membership } = await requireMembership(slug)
```

em vez de resolver sessão e membership na mão. Páginas de workspace, o
contexto de projeto e o de wiki seguiram o mesmo caminho. Uma página sem
dado de servidor próprio (um formulário client, como o de criar
workspace) recebe um `ConsentGate`: um server component que chama
`requireConsentedUser` e renderiza `null`, dentro de `<Suspense>`.

### O proxy

O proxy ganhou uma checagem otimista, só em GET de página:

```ts
if (
  request.method === 'GET' &&
  !pathname.startsWith('/api/') &&
  !pathname.startsWith('/onboarding') &&
  !request.headers.has('next-action')
) {
  const isSecure = request.cookies.has('__Secure-better-auth.session_token')
  if ((await readCookieConsent(request, isSecure)) === 'missing') {
    return NextResponse.redirect(
      new URL('/onboarding/consent-setup', request.url)
    )
  }
}
```

Server action (POST) fica de fora porque não segue redirect, e API fora
porque as rotas aplicam consentimento sozinhas.

O plano original era maior: o proxy também mandaria pra `/sign-in` quem
tivesse sessão inválida, sem ir ao banco. Não deu, e o motivo está no
código do Better Auth 1.7.5: `getCookieCache` devolve `null` quando a
assinatura HMAC não bate **e** quando o cookie simplesmente venceu. Um
cookie adulterado e um cookie com 5 minutos e 1 segundo são
indistinguíveis por essa API. Redirecionar no `null` mandaria pro login,
a cada 5 minutos, todo usuário legítimo. Então o resultado tem três
estados, e só um bloqueia:

```ts
// `unknown` covers no cache, an expired one (every 5 min, the normal case) and
// a tampered on alike: getCookieCache returns null for all three, so none of
// them is a reason to block.
export type CookieConsent = 'consented' | 'missing' | 'unknown'
```

O cookie cache trouxe um problema próprio: depois de aceitar os termos, o
cookie ainda dizia "sem consentimento" por até 5 minutos, e o proxy
mandaria o usuário de volta pra tela de termos. A action de consentimento
apaga o `session_data` — sem o plugin `nextCookies`, o Better Auth não
consegue renovar cookie dentro de uma server action — e a próxima leitura
de sessão o reemite do banco. Pro aceite feito em outro dispositivo, um
`ConsentRefresh` no cliente pede a sessão com `disableCookieCache` e sai
com navegação completa, pra nenhum cache de roteador repetir a resposta
velha.

### O teste de bypass

`app/(private)/__tests__/access.e2e.test.ts` pede **9 páginas** do
workspace — home, projetos, arquivados, wiki, membros, billing, issues de
um projeto, settings do projeto e labels — como quatro visitantes que não
deveriam vê-las:

| Visitante | Esperado |
| --- | --- |
| Anônimo | 307 pra `/sign-in` |
| Logado, mas não membro | 404 |
| Membro sem consentimento, com cookie cache | 307 do proxy pra `/onboarding/consent-setup` |
| Membro sem consentimento, sem cookie cache | redirect pro consentimento, emitido pela DAL |

Em todos os casos o corpo da resposta não pode conter o id do workspace
nem o nome de um projeto semeado só pra isso. É a última linha que pegou o
vazamento: o teste entrou num commit e a correção no seguinte, 4 segundos
depois, porque a ordem certa era provar o buraco antes de mexer nos
portões.

### Remover o portão, e o que isso destravou

Só com as leituras passando pela DAL e o teste verde é que o
`(private)/layout.tsx` foi apagado. Antes dele, o app logado inteiro era
bloqueante por decisão minha: em 28 de setembro eu tinha declarado
`instant = false` nessa árvore, com a justificativa escrita no commit —
"making those routes genuinely instant means a cached shell with the
per-user parts behind skeletons, which is a UX change, not a bug fix".

Sem portão no layout, essa mudança de UX ficou possível:

- O layout do workspace renderiza a moldura na hora; cabeçalho, sidebar e
  banner de trial esperam em `<Suspense>` próprios.
- Os sidebars de home, settings, settings de projeto e wiki, e as abas do
  projeto, fazem streaming ao lado da página com um skeleton do mesmo
  tamanho.
- Cada página do workspace mostra breadcrumb e título imediatamente e lê o
  dado dentro de um `<Suspense>` com `PageSkeleton`. No build, toda rota do
  workspace vira prerender parcial.
- `app/loading.tsx` mostra o símbolo da Nexo animado (`NexoMarkLoader`),
  as duas peças acendendo em sequência, parado sob
  `prefers-reduced-motion`.
- O `validationLevel: 'manual-warning'` saiu do `next.config.ts`: o Next
  volta a validar navegação instantânea em toda página.

## Resultados

| | Portão no layout | DAL + proxy otimista |
| --- | --- | --- |
| Membro sem consentimento (antes do fix: sempre; depois: só sem o cookie cache) | redirect **e** dado da página no payload | redirect, corpo sem id do workspace nem nome de projeto |
| Onde a regra STR-61 é aplicada em render | 1 layout | toda leitura de dado do workspace |
| Páginas validadas como instantâneas (`instant = true`) | só as que optavam | **32** |
| Segmentos que bloqueiam de propósito (`instant = false`) | a árvore privada inteira | **7** (6 páginas e o layout admin) |

Na validação local, varri as rotas com um usuário de teste contando
`Error: Route` no log do `next dev` (o aviso de Cache Components pra rota
que bloqueia sem declarar): **0** em 33 rotas privadas, 33 públicas e 6 do
onboarding. Esse número é da minha nota de validação, não de um job de CI —
o que o CI garante é o teste de acesso e a validação do Next, que agora
roda em toda página.

O número que este post **não** tem é de latência. Eu não medi navegação
logada antes e depois; o teste de carga desse perfil depende de deploy e
ainda não rodou. "Instantâneo" aqui quer dizer o que o Next valida — a
rota tem um shell pronto pra mostrar na hora —, não um p95.

## Onde quebrou / limitações

**Revogação leva até 5 minutos pra chegar numa aba aberta.** É a
consequência direta do `stale: 300`. O servidor e as rotas de API veem
uma sessão revogada ou um consentimento retirado na hora; uma aba que já
tem o shell no roteador continua mostrando o conteúdo autenticado até o
cache vencer. É o preço exato de entrar no App Shell, e eu aceitei porque
toda mutação continua passando pela API.

**Redirect depois do shell não é mais um 307.** Quando a checagem roda
dentro de `<Suspense>`, o status HTTP já saiu como 200 antes de ela
terminar. O redirect vira um meta refresh no meio do HTML, e o 404 vira
um 200 com `NEXT_HTTP_ERROR_FALLBACK;404` no corpo — o teste de acesso
aceita as duas formas por isso. Pra um usuário não muda nada; pra um
monitor que olha status code, um workspace inexistente parece existir. É
por isso que as páginas públicas cujo conteúdo é o próprio registro
(`/careers/[slug]`, `/status/incident/[id]`, `/blog/[slug]`) continuam com
`instant = false`: um id desconhecido precisa responder 404 de verdade. A
área admin e o redirect de `projects/[slug]` também ficaram bloqueantes.

**Relógio depois de cache privado.** O banner de trial lia `Date.now()`
depois do `requireMembership`. Como a membership é cache privado, esse
código cai no shell prefetchado, onde o Next recusa ler o relógio — e toda
rota do workspace acusou. A decisão "o trial está nos últimos dias?" foi
pro navegador, num `HeaderTrialBanner` client. O efeito colateral: a data
de fim do trial agora vai pro cliente sempre que existe trial sem
assinatura, não só nos últimos dias. Não é dado sensível pra um membro,
mas é mais dado no payload do que antes.

**`use cache` é por instância.** A produção roda cinco instâncias do app
atrás do nginx, e o cache padrão do `'use cache'` vive em cada uma. Um
`updateTag` numa mutação limpa só a instância que atendeu a request. Por
isso `/careers` faz streaming em vez de cache — o caminho "cachear a lista
de vagas" existe e eu não usei.

**O proxy não sabe dizer "sessão inválida".** Pelo motivo do
`getCookieCache` acima, o proxy só redireciona um caso: cookie válido sem
consentimento. Todo o resto cai na DAL. Não é falha de segurança —
a DAL é o portão —, mas a checagem otimista ficou menor do que eu
planejei.

**A lista do teste de acesso é mantida à mão.** As 9 páginas estão
escritas no arquivo. Uma página privada nova que ninguém adicionar ali não
é verificada por fora. É a mesma fraqueza do `PUBLIC_ROUTES` do proxy:
disciplina, não tipo.

E uma nota pra quem for conferir o histórico: a remoção do
`(private)/layout.tsx` entrou no repositório dentro do commit
`7db5f436`, cujo título fala de um timeout de teste de formulário. O
`git log` do arquivo leva até lá. O commit apaga mesmo o arquivo, mas a
explicação da mudança está no `bad53505`, 4 segundos depois.

## O que isso prova, e o que não prova

Prova que um portão de autorização em layout, no App Router, é mais fraco
do que parece: ele redireciona, o navegador obedece, e o resto da rota
renderiza assim mesmo. E prova que o único jeito de ver isso é olhar o
corpo da resposta, não o comportamento do navegador — e mandar o cookie do
jeito que o navegador manda.

Prova que mover a checagem pro lado do dado é o que destrava o shell
instantâneo: sem portão bloqueante no topo, cada pedaço da página pode
esperar só pelo que precisa.

Não prova que o app ficou mais rápido em número — não medi. Não prova que
toda página privada está coberta pelo teste de acesso, só as 9 que estão na
lista. E não prova que não existe outro layout lendo dado fora da DAL: a
regra hoje é uma convenção documentada e um teste por amostragem, não algo
que o compilador impeça.
