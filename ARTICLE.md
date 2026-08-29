# Como escrever/revisar artigos deste blog

Guia de voz, estrutura e convenções para `content/writing/**`. Leia isto antes
de escrever ou revisar qualquer post. É um documento vivo — ajuste conforme
publicar mais artigos e perceber que algo aqui não reflete mais o que você
quer.

O post de referência para tudo aqui é
`content/writing/pt/cluster-lpa2v-appsec.md` (e sua versão
`content/writing/en/cluster-lpa2v-appsec.md`). Quando um item abaixo estiver
vago, olhe como ele foi resolvido lá.

## Pilares de conteúdo

O blog tem três pilares técnicos, nesta ordem de prioridade:

1. **Arquitetura** — o pilar principal. É onde entram o maior volume e o maior
   cuidado de escrita.
2. **Engenharia** — práticas, decisões e trade-offs de implementação.
3. **Algoritmos** — pesquisa/projetos aplicados (ex.: LPA2v).

Fora desses três, cabem artigos técnicos pontuais sobre temas específicos que
surgirem no dia a dia — mas eles não são o foco recorrente do blog.

Além dos três, existe uma categoria pessoal — vida, vida de startupeiro,
livros, reflexão no estilo "vida, verdade e o universo" (ex.: o post sobre
Hábitos Atômicos, ou o de custos jurídicos/financeiros de abrir a Nexo,
`cost-of-founding-a-software-startup`). Não compete em prioridade com os
pilares técnicos nem precisa ser pontual como os artigos avulsos — é espaço
reconhecido do blog, não uma exceção.

## Tipos de post e o tom de cada um

O tom **não é único** — varia por tipo de post. Antes de escrever, identifique
qual destes é:

- **Projeto/pesquisa técnica** — bastidores de algo que você construiu ou
  investigou (ex.: LPA2v). Primeira pessoa, narrativo, dev contando o próprio
  trabalho pra outro dev. Estrutura fixa obrigatória (ver seção abaixo) e
  seção de limitações **inegociável**.
- **Tutorial/how-to** — ensinar algo passo a passo. Tom mais direto e
  instrucional, menos narrativo. Não precisa de gancho pessoal longo nem de
  seção de "onde quebrou" — mas se o tutorial tem uma pegadinha conhecida ou
  um caso em que a abordagem falha, isso entra como aviso pontual, não como
  seção separada.
- **Opinião/reflexão** — argumentativo, sobre um tema (carreira, ferramentas,
  indústria, vida pessoal, livros), sem necessariamente ter um projeto por
  trás. Primeira pessoa, pode ser mais solto estruturalmente, mas ainda
  precisa de uma tese clara, não só impressões soltas. É o tom padrão pra
  posts da categoria pessoal.
- **Nota rápida/TIL** — curto, registra algo que você aprendeu ou resolveu.
  Sem gancho elaborado, sem estrutura de seções — vai direto ao ponto e
  termina quando a ideia acaba.

Em todos os casos: primeira pessoa é o padrão do blog. Você é quem fala, não
uma voz institucional.

## Regras universais (valem pra todo post, qualquer tipo)

**Frases banidas — nunca escreva:**

- Clichês de abertura: "No mundo atual...", "Em um cenário onde...", "É
  importante notar que...", "Nos dias de hoje...".
- Fechos genéricos: "Em resumo...", "Portanto, podemos concluir que...", "O
  futuro é promissor", "Isso mostra a importância de...".
- Hedging desnecessário: "pode ser que", "possivelmente", "em certa medida" —
  quando você na verdade tem certeza do que está afirmando. Hedge só quando a
  incerteza é real e vale a pena nomear (ex.: "não recalibrei a fórmula para
  corrigir isso" é uma limitação honesta, não hedge vazio).

**Concretude acima de tudo:**

- Números reais em vez de qualificadores vagos. Não "melhorou
  significativamente" — "de 2.493 falsos positivos para 0".
- Cite a fonte do dado quando fizer uma afirmação quantitativa (o
  paper/repo/experimento de onde veio).
- Termos técnicos em `código inline` quando forem identificadores, estados ou
  nomes exatos (`inconsistente`, `SAST`, `object-cover`) — não em itálico ou
  aspas.

**Extensão:** não tem tamanho-alvo. O assunto dita o tamanho — um TIL pode ter
5 linhas, um post de projeto pode ter 2000 palavras. Não alongue pra parecer
mais completo, não corte pra parecer mais direto.

## Estrutura obrigatória — posts de projeto/pesquisa técnica

Todo post desse tipo segue esta ordem de seções (os nomes das seções em si
podem variar, a sequência lógica não):

1. **Gancho** — abre pelo problema/dor em termos concretos e relacionáveis,
   antes de nomear a solução. Nada de "Neste artigo, vou apresentar...".
2. **Problema** — o que quebra nas abordagens existentes, estrutural, não
   superficial. Mostre onde exatamente elas falham, com exemplo concreto.
3. **Ideia** — o insight central, explicado de forma simples antes de
   qualquer formalismo.
4. **Como funciona / arquitetura** — a implementação, no nível de detalhe que
   um outro dev precisa pra entender a decisão de design, não um tutorial de
   código linha a linha.
5. **Resultados** — números comparativos, tabelas, gráficos quando existirem.
   Sempre comparando contra a alternativa anterior/ingênua, não só mostrando
   o número final isolado.
6. **Onde quebrou / limitações** — **inegociável**, sem exceção, para este
   tipo de post. Aponte a causa raiz do ponto mais fraco do trabalho, não só
   que ele existe. Se você decidiu não corrigir algo, diga por que foi uma
   escolha e não um descuido. Nunca esconda o pior número atrás só dos
   melhores.
7. **Fechamento** — reafirme o que o trabalho prova e, explicitamente, o que
   ele **não** prova. Não infle o alcance da conclusão além do que os dados
   sustentam.

Para os outros tipos de post (tutorial, opinião, TIL), essa sequência é só
inspiração — adapte livremente, mas a seção de honestidade/limitações (item 6)
só é obrigatória para projeto/pesquisa técnica.

## Publicação: frontmatter, idiomas, slugs

- Frontmatter obrigatório: `title`, `description`, `icon` (chave de
  `lib/writing-icons.ts`: `pen`, `book`, `code`, `idea`, `note`, `terminal`,
  `bug`, `rocket`), `date` opcional (`"YYYY-MM-DD"`).
- Todo post publicado em dois idiomas usa o **mesmo slug** em
  `content/writing/pt/<slug>.md` e `content/writing/en/<slug>.md` — é isso
  que faz o toggle de idioma linkar pra mesma página.
- PT-BR é o idioma-fonte. A versão EN é **tradução livre/condensada**, não
  1:1: mesma mensagem, mesmos números, mas cada versão soa natural no próprio
  idioma. Reformule frases em vez de traduzir literalmente.

## Imagens e gráficos

- Gráficos/figuras de um projeto (ex.: exports de matplotlib) vão em
  `public/img/<slug>/<locale>/<nome-descritivo>.png` — uma cópia por idioma
  quando o gráfico tem texto (eixos, legendas) no próprio idioma.
- No markdown, `![alt](caminho)` — o `alt` **é a legenda visível**, escreva-o
  como uma legenda real (o que o gráfico mostra, não só "gráfico 1").
- O componente (`WritingImage`) já cuida de: fundo branco fixo (evita choque
  com dark mode em charts com fundo branco), borda, legenda abaixo, e abrir
  em lightbox ao clicar (mesmo padrão visual da home).
- Insira a imagem logo após o parágrafo/tabela que ela ilustra, não todas
  agrupadas no fim.

## Formatação

- Tabelas markdown para qualquer comparação lado a lado de métricas
  (mecanismo × precisão × recall × etc.).
- **Negrito** para números-chave e termos centrais dentro do texto corrido —
  não para frases inteiras.
- `##` para seções principais, `###` só quando uma seção principal realmente
  se divide em subpartes (não force headings menores por padrão).

## Checklist antes de considerar um artigo pronto

- [ ] Abre com o problema/dor, não com "Neste artigo vou apresentar..."
- [ ] Nenhuma frase da lista de clichês de abertura/fecho/hedging
- [ ] Todo número quantitativo bate com a fonte (paper, repo, experimento)
- [ ] Se é post de projeto/pesquisa técnica: tem seção de limitações com
      causa raiz, não só "ainda há espaço para melhorias"
- [ ] Fechamento não afirma mais do que os dados sustentam
- [ ] Frontmatter completo (`title`, `description`, `icon`, `date`)
- [ ] Se publicado em pt + en: mesmo slug nas duas pastas, EN é tradução
      livre (não literal), números idênticos aos do PT
- [ ] Imagens (se houver) com `alt` funcionando como legenda real, posicionadas
      perto do trecho que ilustram, com versão pt/en separada se tiverem texto
