---
title: Três cargas, três propósitos — a estratégia de teste de carga da Nexo com k6
description: "O post sobre escalar a Nexo pra 1 milhão de usuários contou uma história: um load test achou um bug real. Este não conta uma história — é a estrutura por trás dela. Por que existem três scripts de carga separados, não um só, cada um respondendo uma pergunta diferente, rodando num momento diferente do pipeline, e o que fica sem cobertura quando nenhum deles roda contra produção de verdade."
icon: rocket
date: "2026-08-29"
---

O post sobre escalar a Nexo pra 1 milhão de usuários contou uma história:
um load test achou um bug real, uma query sem paginação devolvendo 8,6MB
por request. Este post não conta uma história — é a estrutura por trás
dela. Por que existem **três** scripts de carga separados no diretório
`k6/`, não um só, e por que cada um responde uma pergunta diferente.

## O problema: um script de carga só serve a uma pergunta por vez

Um teste que sobe carga pesada é bom pra achar onde o sistema quebra, mas
péssimo pra rodar em todo push — é lento e caro demais pra esse ritmo. Um
teste leve é rápido o bastante pra rodar sempre, mas não revela nada sobre
degradação sob pressão real. Usar o mesmo script pras duas coisas significa
escolher um lado e ficar cego pro outro risco.

## A ideia: um script por pergunta, cadência própria por script

**Smoke — "está quebrado?"**

```js
export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
}
```

Uma VU só, 30 segundos, checando que `/`, `/sign-in`, `/sign-up`, `/contact`
respondem 200 em menos de 500ms. Não testa carga, testa correção funcional
sob condição mínima — se isso falha, não tem sentido nenhum rodar nada mais
pesado.

**Load — "degrada com que forma sob rampa real?"**

```js
export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '1m', target: 20 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<1500'],
    http_req_failed: ['rate<0.01'],
  },
}
```

Rampa de 5 até 20 VUs simultâneas, com thresholds de percentil — não é só
"não quebrou", é "quão devagar ficou, no p95 e no p99, enquanto a carga
subia".

**Api-smoke — auth isolado.** Terceiro script, focado só nas rotas de
autenticação, 1 VU/15s — separado do smoke geral porque autenticação tem
caminho de falha próprio (rate limit, hashing de senha) que uma rota
estática não tem.

## Como funciona: cadência diferente, não intensidade diferente por acaso

| Cenário | Carga | Quando | Bloqueia? |
| --- | --- | --- | --- |
| `smoke-test.js` | 1 VU, 30s | PR/push (local) + semanal (produção) | sim |
| `api-smoke-test.js` | 1 VU, 15s | PR/push (local) + semanal (produção) | sim |
| `load-test.js` | rampa 5→20 VUs | PR/push (local) | não — `continue-on-error` |

Smoke roda em dois lugares: contra o build local em todo PR/push, e contra
produção real, agendado. Load roda só localmente, e com
`continue-on-error` — um threshold de latência estourado não trava o push,
vira sinal pra olhar, não gate obrigatório. A assimetria é proposital:
"está quebrado" é binário e barato o bastante pra bloquear; "degradou sob
carga" é informação rica demais pra decidir sozinha se um commit pode ou
não subir.

## Resultados: a estrutura que tornou o bug do post anterior encontrável

A razão de existir um `load-test.js` com rampa e thresholds de percentil —
não só um smoke de correção — é exatamente o que permitiu achar o
`/issues` devolvendo 8,6MB por request no post anterior: sem pressão
simulada com múltiplas VUs concorrentes, o sintoma (latência que sobe de
~1s pra ~12s sob 15 usuários simultâneos) nunca teria aparecido num teste de
1 VU só.

## Onde quebrou: local não é produção, e produção só recebe o teste mais leve

A lacuna mais direta: `load-test.js`, o único que realmente estressa
concorrência, roda contra **build local** — não contra a infraestrutura de
produção, com seus próprios limites de recurso, latência de rede real,
tamanho de banco real. Passar localmente não garante passar em produção; foi
justamente rodando um teste manual, fora dessa cadência automática, contra
produção real, que o bug do post anterior apareceu — o k6 agendado contra
produção só roda o smoke, o mais leve dos três.

Isso significa que produção nunca é testada sob carga de forma automática e
recorrente — só sob correção funcional. Qualquer degradação que só aparece
com volume real de dados ou concorrência real de usuários depende, hoje, de
alguém rodar esse teste manualmente e a tempo, como aconteceu uma vez.

## O que isso prova, e o que não prova

Prova que separar "está quebrado" de "como degrada sob carga" em scripts
diferentes, com cadências diferentes, é o que permite os dois sem que um
atrapalhe o outro — smoke rápido o bastante pra bloquear sempre, load rico
o bastante pra informar sem travar. Prova que essa estrutura foi o que
tornou o achado do post sobre 1 milhão de usuários possível de se
encontrar num teste, não só na produção quebrando de verdade. Não prova que
produção está protegida contra degradação sob carga de forma contínua — só
o smoke roda lá, agendado; o load real depende de alguém rodar manualmente.
