---
title: A observabilidade que mente pra você
description: "Passei horas convencido de que o PostHog estava quebrado em produção na Nexo. Nunca esteve: o posthog-js descarta todo evento, em silêncio, quando o navegador parece automatizado, e eu estava verificando com um navegador automatizado. Puxando esse fio, apareceram mais três buracos: um GA4 que a própria CSP do Nexo bloqueava, um Sentry sem nenhum source map, e uma flag de privacidade que descartava quem tinha clicado em 'Aceitar'. Nenhum deles gerava erro."
icon: bug
date: "2026-12-03"
---

Passei boa parte de uma tarde convencido de que o PostHog estava quebrado em
produção na Nexo. Abria o site num Chromium dirigido pelo Playwright, aceitava
os cookies, navegava, e nada chegava. Nenhum request, nenhum erro no console,
nenhum aviso. O `localStorage` tinha a chave `ph_<token>_posthog`, o cookie
estava lá, o `init()` tinha rodado. Tudo parecia saudável, e nenhum evento saía.

O PostHog nunca esteve quebrado. Quem estava errado era o verificador.

Esse dia, 22 de setembro, virou uma auditoria de toda a observabilidade da
Nexo. O padrão que apareceu se repetiu em quatro lugares: a ferramenta não
falha com barulho, falha calada, e falha justamente no momento em que você
vai conferir se ela funciona.

## O problema: ausência de dado não é uma medição

Quando um sistema de produção quebra, ele costuma avisar: um 500, um log de
erro, um alerta. Ferramenta de analytics e de observabilidade quebra de outro
jeito. Ela é desenhada pra nunca atrapalhar a aplicação, então engole os
próprios erros. Um evento que não foi enviado não deixa rastro. Um script
bloqueado vira uma linha de violação de CSP que ninguém lê. Um source map que
não existe só aparece quando você precisa ler um stack trace e encontra nome
de chunk minificado.

O resultado é que "não vi nada chegando" tem duas leituras possíveis, e as
duas parecem iguais de fora: ou não aconteceu nada pra medir, ou a medição
está desligada. Sem um controle positivo (um caso em que você **sabe** que
deveria chegar dado), zero eventos não prova nada.

Antes desse dia, a Nexo tinha três ferramentas de medição no navegador, e
nenhuma estava medindo o que eu achava:

- **Vercel Analytics e Speed Insights**: os beacons iam para
  `/_vercel/insights/*` na própria origem do Nexo, um caminho que só existe
  quando o app roda na Vercel. A Nexo roda num servidor próprio, então a
  resposta era um `307` para `/sign-in`. Não coletavam nada.
- **Google Analytics 4**: montado atrás do banner de consentimento, sem
  coletar nada (detalhe abaixo).
- **PostHog**: recém-instalado, e aparentemente mudo.

## A ideia: toda verificação precisa de um caso que deveria dar positivo

O insight não é sofisticado, mas mudou como eu verifico qualquer coisa de
telemetria: antes de concluir que algo não funciona, preciso provar que meu
instrumento de verificação consegue ver o caso em que funciona. E antes de
concluir que algo funciona, preciso olhar o artefato que ele deveria produzir
(o request, o arquivo `.map`, a linha no painel), não o fato de que ele foi
inicializado sem erro.

`init()` sem erro não é evidência de coleta. Release criado no Sentry não é
evidência de simbolicação. Banner com botão "Aceitar" não é evidência de que
quem aceitou está sendo medido.

## Como funciona (e onde cada ferramenta mentia)

### PostHog: a defesa anti-bot que te cega

O `posthog-js` tem uma função, `isLikelyBot()`, que roda antes de qualquer
envio. Se ela devolve `true`, o evento é descartado: sem log, sem request, sem
erro. No bundle instalado (`posthog-js` 1.433.5), minificado, ela é isto:

```js
const Ua=function(t,i){if(!t)return!1;const e=t.userAgent;if(e&&Q(e,i))return!0;
try{const e=null==t?void 0:t.userAgentData;
if((null==e?void 0:e.brands)&&e.brands.some(t=>Q(null==t?void 0:t.brand,i)))return!0}
catch(t){}return!!t.webdriver}
```

São três marcas, e qualquer uma basta:

1. `navigator.webdriver` verdadeiro, que todo navegador dirigido por
   automação expõe;
2. o `userAgent` casando com a lista de bots, onde está `headlesschrome`;
3. `navigator.userAgentData.brands` contendo `HeadlessChrome`.

A terceira foi a que me enganou por último. Trocar o `userAgent` no Playwright
resolve a segunda marca, e eu achei que tinha resolvido o problema. Mas o
`userAgentData` é outra API, e sobrevive à troca do user agent. Com ela
intacta, o SDK continuava descartando tudo.

Dois sinais falsos reforçaram a conclusão errada:

- `window.posthog` é **sempre** `undefined` quando o PostHog é instalado pelo
  pacote npm. Só o snippet do CDN cria esse global. Eu li isso como "não
  carregou".
- Os chunks do Turbopack têm nome de hash. Procurar na aba de rede um recurso
  com "posthog" no nome e não achar nenhum não prova nada.

Mascarando as três marcas, a verificação em produção fechou dos dois lados:
sem consentimento, **zero** requests; com consentimento, `POST /ingest/e/`
respondendo `200 {"status":"Ok"}`, sem violação de CSP. E testei o caminho
real do visitante, clicando em "Aceitar" no banner, não só com o cookie de
consentimento pré-gravado.

### GA4: o script que a minha CSP recusava

O Google Analytics estava montado atrás do consentimento e não coletava nada.
O `gtag/js` vem de `googletagmanager.com`, e a CSP da Nexo
(`script-src 'self' 'unsafe-inline'`) recusa qualquer script de outra origem.
Cada visita que aceitava cookies gerava uma violação de CSP e zero dado.

Não abri uma exceção na CSP. Com o PostHog funcionando, não havia motivo pra
manter uma segunda ferramenta, muito menos uma bloqueada. O commit `b7ebf52`
tirou o GA, o pacote `@next/third-parties`, a variável `NEXT_PUBLIC_GA_ID` e a
frase da política de cookies que dizia que usávamos GA4.

Os três eventos deliberados que o GA carregava (`pricing_plan_click`,
`blog_post_read`, `talk_to_sales_submit`) foram para o PostHog por um helper
novo, `captureEvent`. O detalhe que importa nele é onde o consentimento é
checado:

```ts
export function captureEvent(
  event: string,
  properties?: Record<string, string | number | boolean | null>,
): void {
  if (!hasAnalyticsConsent()) return
  void loadPostHog().then((posthog) => {
    posthog?.capture(event, properties)
  })
}
```

O helper relê o cookie de consentimento **em cada chamada**, em vez de
confiar em quem chamou. O `<PostHogTracker />`, que manda pageviews, só monta
atrás do gate de consentimento. Mas esses três eventos disparam de handlers de
clique espalhados pelo site de marketing, e um deles disparando para quem
recusou analytics inicializaria o SDK e mandaria um beacon. O gate não pode
morar no componente pai quando o evento nasce em qualquer lugar.

### Sentry: release criado, nada pra simbolicar

O Sentry estava vivo. Um erro disparado em produção chegava com `release`
igual ao commit do deploy e `environment: production`; o lado servidor também,
com spans de banco. O que não funcionava era a simbolicação, e só a API do
Sentry e o bundle mostraram isso:

- `find .next/static -name "*.js.map"`: **0** arquivos;
- nenhum `_sentryDebugIds` ou `debugId` em nenhum dos **12** chunks de
  produção conferidos;
- `debug_meta.images: 0` no evento de um erro real do cliente.

E, ao mesmo tempo, o plugin do Sentry tinha criado **e finalizado** o release
durante o build. Ele rodou com credenciais, fez tudo certo, e não tinha nada
pra subir. Todo stack trace do cliente apontava para nome de chunk minificado.

A causa estava num comentário meu no `next.config.ts`, que dizia que o upload
era "a única coisa que emitiria um `.map`" ao lado do bundle. Isso é uma
premissa do webpack. Com Turbopack, o Next não emite source map de browser sem
`productionBrowserSourceMaps: true`, e o plugin do Sentry não liga essa opção
por você. A correção (commit "emit the browser source maps the upload needs")
liga a geração amarrada às mesmas credenciais do upload:

```ts
const canUploadSourcemaps = Boolean(
  sentryOrg && sentryProject && sentryAuthToken,
);

const nextConfig: NextConfig = {
  // ...
  productionBrowserSourceMaps: canUploadSourcemaps,
```

A amarração é de propósito: os mapas não podem ser gerados onde nada vai
apagá-los depois. No build do CD, `deleteSourcemapsAfterUpload` remove os
arquivos e os comentários `sourceMappingURL` assim que o Sentry os tem, então
o stack trace fica legível no Sentry e ilegível no navegador. Um build local
contra um release descartável (apagado em seguida) confirmou o ciclo inteiro:
"Successfully uploaded source maps to Sentry", **267** chunks com debug id, e
depois **zero** arquivos `.map` e **zero** comentários `sourceMappingURL`
sobrando em `.next/static`.

### GPC: a trava era minha

Depois disso tudo, ainda aparecia um sintoma intermitente: às vezes um
navegador real, não automatizado, não mandava nada. A causa era uma linha que
eu mesmo tinha escrito: `respect_dnt: true`.

Com essa opção, o `posthog-js` trata `doNotTrack` e `globalPrivacyControl` do
navegador como recusa, e devolve consentimento negado **mesmo com o cookie
`nx_cookie_consent=accepted` gravado**. Medi no Firefox 155 real, contra
produção:

| Configuração do Firefox | `dnt` | `gpc` | Eventos enviados |
|---|---|---|---|
| Padrão (proteção Standard) | `unspecified` | `false` | 1 |
| GPC ligado | `unspecified` | `true` | **0** |
| DNT ligado | `1` | `false` | **0** |

O GPC vai ligado por padrão nas janelas privadas do Firefox e no Brave. Na
prática: a Nexo pedia consentimento, a pessoa clicava "Aceitar", e eu
descartava a escolha dela em silêncio.

Um "Aceitar" explícito vence um padrão do navegador. Foi com essa regra que
removi a trava ([`f5369d75`](https://github.com/castrogusttavo/nexo/commit/f5369d75), "stop a browser privacy signal
from overriding consent", `respect_dnt: false`). O raciocínio é meu e não é
parecer jurídico: o GPC é um sinal do navegador que a CCPA, a lei de privacidade da
Califórnia, reconhece como recusa à
**venda ou compartilhamento** de dados pessoais, coisa que a Nexo não faz.
Depois alinhei o texto ao código ([`c35f0342`](https://github.com/castrogusttavo/nexo/commit/c35f0342), que também
corrigiu o comentário do PostHog). A política de privacidade agora diz:
"Não compartilhamos informações pessoais para fins de publicidade, com ou sem
sinal de GPC." O portão que importa continua lá, e continua verificado: sem
cookie de consentimento, ou com um cookie de recusa, o SDK nem carrega e nada
é enviado.

Isso tem um custo que prefiro dizer em público: hoje a Nexo não honra o GPC
para analytics. O consentimento depende só do banner explícito; quem navega
com GPC ligado e clica em "Aceitar" é medido como qualquer outra pessoa. Já
estou resolvendo isso, para que o GPC também conte como sinal na coleta de
analytics.

### Só depois disso: o funil

Com a coleta provada, o PostHog ainda só tinha pageviews e os três eventos
de marketing, e isso só responde quais páginas as pessoas abrem. Seis dias depois, o commit `1d60777`
instrumentou os seis momentos do funil de ativação, todos pelo mesmo
`captureEvent`:

| Evento | O que responde |
|---|---|
| `signup_submitted` | disparado depois da validação, antes do request |
| `signup_completed` | o intervalo entre os dois é o que a própria API custa em cadastros abandonados |
| `email_verified` | gate duro: sem verificação não existe sessão |
| `issue_created` | o momento de ativação; o PostHog deriva a primeira ocorrência por pessoa |
| `invite_sent` | alguém trouxe outra pessoa, o sinal mais forte de adoção |
| `checkout_started` | disparado na tela onde o pedido é preenchido, antes do provedor de pagamento |

Não tem evento de onboarding porque os quatro passos do onboarding são
páginas, e os pageviews já dão a queda passo a passo. E não tem captura
server-side em lugar nenhum, de propósito. O `checkout_started` é o caso mais
tentador, porque o webhook do pagamento é a fonte mais confiável de "comprou".
Mas o webhook não tem navegador, e contar a partir dele seria analytics fora
do consentimento que o banner pede e que a política de privacidade descreve. A
troca está escrita no código: quem fecha a aba no meio do pagamento some do
funil, e continua no banco, que é onde receita é contada de qualquer jeito.

## Resultados

| Ferramenta | Antes de 22/09 | Depois |
|---|---|---|
| Vercel Analytics / Speed Insights | beacons respondendo `307` para `/sign-in`, nada coletado | removidos, com o host da CSP |
| GA4 | bloqueado pela CSP, uma violação por visita que aceitava | removido; 3 eventos migrados para o PostHog |
| PostHog | parecia mudo (era o verificador) | sem consentimento: 0 requests; com: `POST /ingest/e/` → `200` |
| Sentry (cliente) | 0 `.map`, `debug_meta.images: 0` | build local: 267 chunks com debug id, 0 `.map` sobrando |
| Firefox com GPC ou DNT | 0 eventos mesmo depois de "Aceitar" | trava removida; o gate é o banner |
| Eventos de produto | 3 (no GA, que não coletava) | 3 de marketing + 6 do funil de ativação |

A comparação honesta não é "antes coletava pouco, agora coleta muito". É que
antes eu **acreditava** ter três ferramentas medindo, e tinha zero. Nenhum dos
quatro buracos gerava erro em lugar nenhum. Todos foram achados olhando o
artefato que deveria existir (o request, o arquivo, o evento no Firefox real)
em vez de olhar se a ferramenta tinha inicializado.

## Onde quebrou: o que continua sem prova

A primeira limitação é a mais irônica: **a suíte de navegador da Nexo ainda
não consegue afirmar nada sobre o PostHog.** A verificação que fechou o caso
foi manual, mascarando as três marcas de automação na mão. Nenhum spec em
`e2e/` faz isso hoje. A causa raiz é a mesma do bug original: o Playwright é
exatamente o tipo de navegador que o `isLikelyBot()` foi feito pra ignorar, e
um teste que assere "nenhum evento foi enviado sem consentimento" passaria
mesmo com o gate de consentimento quebrado, porque o SDK descartaria tudo de
qualquer jeito. É um teste que sempre passa, que é pior do que não ter teste.
Para ser útil, o spec precisa mascarar `webdriver`, o user agent e o
`userAgentData`, e ainda não escrevi isso.

A segunda: o upload de source maps foi provado num build local, não no CD. No
log do CD, o build roda dentro do `docker buildx`, e a saída do plugin do
Sentry não aparece lá de forma que eu consiga apontar a linha "uploaded". Até
eu abrir um erro de cliente no Sentry depois de um deploy e ver o stack trace
simbolicado, a afirmação "o CD sobe os mapas" é inferência a partir da mesma
configuração, não medição.

A terceira é de desenho, não de bug: **o funil mede só quem aceitou
analytics.** Quem recusa o banner não existe para o PostHog, por decisão. Isso
quer dizer que as taxas de conversão do funil são de uma amostra
autosselecionada, não da população de visitantes. Escolhi isso conscientemente
em vez de captura server-side, e o preço é que nenhum número do funil pode ser
lido como "x% dos visitantes".

E o último buraco silencioso apareceu depois, em outra camada: o wrapper de
rota e o `proxy.ts` chamavam `logger.flush()` do Axiom em cada request, e sob
carga isso derrubou a produção por exaustão de heap. Conto essa no
[post sobre sair de uma para cinco instâncias](/pt/writing/from-one-to-five-nextjs-instances).

## O que isso prova, e o que não prova

Prova que, na Nexo, as quatro falhas de observabilidade encontradas nesse dia
tinham a mesma forma: nenhuma gerava erro, e todas pareciam saudáveis por
algum sinal secundário (um `init()` que roda, um release que é criado, um
cookie que é gravado). E prova que, para essas ferramentas especificamente, a
ausência de dado num navegador automatizado não é evidência de nada: o
`posthog-js` foi feito pra ser cego ali.

Não prova que a observabilidade da Nexo está completa agora. A verificação do
PostHog não está automatizada, o upload de source maps no CD não foi
observado diretamente, e o funil enxerga só quem consentiu. Também não prova
que a decisão sobre o GPC vale para outro produto: ela se apoia no fato de a
Nexo não vender nem compartilhar dados e no que a política de privacidade dela diz. O
que eu levo daqui é um hábito, não uma garantia: antes de confiar num zero,
provar que o instrumento é capaz de mostrar um positivo.
