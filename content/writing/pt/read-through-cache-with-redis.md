---
title: Cache que nunca derruba um request — read-through com Redis na Nexo
description: "Toda camada de cache tem uma pergunta que decide se ela é segura: o que acontece quando o Redis está fora do ar? Na Nexo, a resposta é que nenhum método de cache pode propagar exceção — get vira miss, set e invalidate viram no-op logado, e o request nunca sabe que o Redis caiu. Isto é como o read-through por entidade funciona, os três Redis lógicos rodando na mesma infraestrutura, e a lacuna que fica aceita de propósito: sem proteção contra stampede."
icon: code
date: "2026-08-29"
---

Toda vez que alguém adiciona uma camada de cache, tem uma pergunta que
decide se ela é segura ou se virou um novo jeito de derrubar produção: **o
que acontece quando o Redis está fora do ar?** Se a resposta for "a request
quebra", a camada de cache não reduziu risco — ela criou uma dependência
nova, obrigatória, num serviço que só existia pra ser opcional.

Na Nexo, a resposta é testável olhando o código: todo método de cache —
`get`, `set`, `invalidate` — está dentro de um `try/catch` que nunca deixa
nada subir.

```ts
async get(id: string): Promise<T | null> {
  try {
    const client = await ensureRedisConnected()
    const data = await client.get(`${prefix}${id}`)
    if (!data) return null
    return JSON.parse(data) as T
  } catch (cause) {
    warn('get', id, cause)
  }
  return null
}
```

Redis fora do ar e cache miss produzem exatamente o mesmo resultado pra
quem chama: `null`. A diferença só existe no log.

## O problema: cache vira dependência dura por acidente

O jeito mais comum de uma camada de cache virar risco é justamente não
pensar nesse caso — deixar a exceção do client Redis subir crua. Numa
implementação ingênua, uma falha de conexão no `get` vira uma exceção não
tratada no meio do request, e o que era pra ser uma otimização de latência
vira um novo motivo de 500 que não existia antes de o cache existir. O
segundo problema, menos óbvio, é a invalidação: cachear sem uma política
clara de quando invalidar produz dado velho servido com confiança — pior
que não ter cache nenhum, porque o erro é silencioso.

## A ideia: read-through por entidade, com degradação em toda operação

Cada cache de domínio é um objeto `{ get, set, invalidate }`, construído
por uma factory compartilhada:

```ts
// src/cache/_cache.ts
export function createKeyedCache<T>({ prefix, ttl, name }: KeyedCacheConfig): KeyedCache<T> {
  // ...
  return {
    async get(id) { /* try/catch → null em qualquer falha */ },
    async set(id, value) { /* try/catch → no-op logado */ },
    async invalidate(id) { /* try/catch → no-op logado */ },
  }
}
```

E cada entidade só declara prefixo, TTL e nome:

```ts
// src/cache/notification-setting.cache.ts
export const NotificationSettingCache = createKeyedCache<NotificationSettingDTO>({
  prefix: 'notif:',
  ttl: 15 * 60,
  name: 'notification_settings',
})
```

O padrão read-through — tentar o cache, cair pro banco no miss, popular o
cache pro próximo request — não vive dentro do objeto de cache. Vive no
service:

```ts
async get(actorId: string) {
  const cached = await NotificationSettingCache.get(actorId)
  if (cached) return ok(cached)

  const found = await NotificationSettingRepository.findByUserId(actorId)
  if (!found.ok) return found

  const dto = toNotificationSettingDTO(found.value)
  await NotificationSettingCache.set(actorId, dto)
  return ok(dto)
}
```

O objeto de cache não conhece o repository — só sabe guardar e devolver
bytes. Quem decide *quando* consultar o quê é o service, o que mantém a
camada de cache burra de propósito e fácil de testar isolada.

## Como funciona: três caches hoje, TTL amarrado a uma janela real

| Cache | Chave | TTL | Conteúdo |
| --- | --- | --- | --- |
| `UserCache` | `user:<userId>` | 15 min | `UserDTO` |
| `WorkspaceCache` | `workspace:<workspaceId>` | 15 min | `WorkspaceDTO` (sem memberships) |
| `StatusCache` | `status:snapshot:v1` (chave única) | 30 s | snapshot da status page |

O TTL de 15 minutos em `User`/`Workspace` não é um número redondo escolhido
à toa — é a mesma janela de vida do access token, então cache e sessão
expiram de forma coerente. `StatusCache` carrega um sufixo de versão
(`:v1`) na própria chave: mudar o formato do snapshot é só trocar pra
`:v2`, sem precisar de migração — a chave velha simplesmente para de ser
lida e expira sozinha.

A política de escrita é uma frase só: **writes invalidam, nunca
repopulam.** `create`/`update`/`delete` chamam `invalidate`; a próxima
leitura repovoa via read-through. Isso evita o cenário de gravar um estado
intermediário no cache que nunca existiu de verdade no banco. Tem também
invalidação cruzada: quando uma mudança de `membership` afeta o
`WorkspaceDTO` cacheado de alguém, invalida os dois lados — `User` e
`Workspace` — porque o DTO de workspace não carrega a lista de membros, só
quem depende dessa relação sabe que precisa invalidar o outro.

Um detalhe estrutural que só aparece quando se olha a infraestrutura
inteira: a Nexo tem **três consumidores lógicos de Redis, dois clients
diferentes, um servidor físico só**. O cache de aplicação usa `redis`
(node-redis) com conexão lazy — nada conecta no import, só o primeiro
`ensureRedisConnected()` abre o socket. A fila de background (BullMQ,
artigo separado) usa `ioredis`, com `maxRetriesPerRequest: null` — exigência
do próprio BullMQ, incompatível com a config do cache de app. Dois clients
que não sabem um do outro, apontando pro mesmo Redis.

## Resultados: disciplina de cobertura, não benchmark

Diferente do post sobre escalar a Nexo pra 1 milhão de usuários, aqui eu não
tenho um número de hit-rate ou de latência pra mostrar — não existe teste
de carga rodado contra essa camada especificamente. O que existe é
arquitetura por design: três caches cobrindo as entidades mais lidas (user,
workspace, status), TTL coerente com uma janela de negócio real em vez de
arbitrária, e uma regra de invalidação que não depende de lembrar de
repopular. Devo essa diferença ao leitor em vez de inventar um número que
não tenho.

## Onde quebrou: sem proteção contra stampede, de propósito

A lacuna mais real, documentada e aceita: **não existe proteção contra
stampede.** Se um TTL expira e várias requests batem no mesmo dado ao mesmo
tempo, todas viram miss e todas batem no Postgres até a primeira `set`
terminar — N requests, N queries, nenhuma delas sabe que as outras estão
fazendo a mesma coisa. Não é um bug não percebido: é uma decisão registrada
de não resolver agora, porque nos volumes atuais o custo de implementar
lock ou stale-while-revalidate seria maior que o problema que resolve. Fica
pra revisitar se virar gargalo de verdade.

Segunda lacuna: **JSON sem versionamento de schema**, exceto `StatusCache`.
Mudar o formato de `UserDTO` ou `WorkspaceDTO` sem bumpar o prefixo pode
entregar um JSON no formato antigo até o TTL expirar — o único cache que
pensou nisso desde o início foi o que menos precisava (snapshot de status
página, TTL de 30s).

Terceira: a degradação silenciosa é uma faca de dois gumes. Proteger o
request de uma falha de Redis é o objetivo — mas como toda falha vira só um
`logger.warn`, um Redis fora do ar por horas não quebra nada visível pro
usuário. Sem alguém olhando os eventos `cache.*.get_failed` no Axiom, o
sistema inteiro pode estar rodando sem cache algum, silenciosamente batendo
mais no Postgres, sem nenhum alarme tocando.

## O que isso prova, e o que não prova

Prova que uma falha de Redis nunca vira uma falha de request — degradação é
o comportamento padrão de toda operação de cache, não uma exceção tratada
caso a caso. Prova que a política de invalidação é simples o bastante pra
não depender de disciplina manual em todo call site: writes invalidam,
read-through repovoa. Não prova que o cache é rápido — não tenho benchmark
pra afirmar isso. Não prova que aguenta stampede — a decisão documentada é
não proteger contra isso ainda, e não devo fingir que essa lacuna não
existe.
