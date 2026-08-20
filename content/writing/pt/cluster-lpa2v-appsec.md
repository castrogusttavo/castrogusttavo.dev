---
title: Ensinando um cluster de neurônios paraconsistentes a triar vulnerabilidades
description: Como um cluster hierárquico de neurônios LPA2v reduziu de 2.493 falsos positivos para 0 em um pipeline de AppSec simulado, e o que isso confirmou (e não confirmou) contra achados reais.
icon: bug
date: "2026-08-18"
---

Todo pipeline de AppSec com um mínimo de maturidade chega nesse ponto: SAST, SCA e
DAST rodando em todo commit, e uma fila de achados que ninguém mais confia. Um
scanner que pisca entre execuções, uma dependência sinalizada no meio de uma
migração planejada, um endpoint que o SAST acusa como vulnerável e o DAST não
consegue nem tocar porque tem um WAF na frente. Cada ferramenta decide sozinha, por
um limiar de severidade, e o resultado é fadiga de alertas — o time para de olhar
para a fila com atenção, porque a maior parte dela é ruído.

Foi esse problema que virei meu trabalho de conclusão de curso: em vez de mais uma
regra `IF-THEN` para suprimir ruído conhecido, tentar um mecanismo que trate
evidências contraditórias como evidências contraditórias, não como um empate que
precisa ser resolvido às pressas.

## O ponto cego dos dois modelos que já existem

Os dois jeitos convencionais de decidir o que vira alerta são:

- **Threshold** — qualquer achado que ultrapasse um limiar isolado (CVSS ≥ 7, um
  match qualquer de SAST) dispara alerta. Simples, mas ignora contexto por
  completo.
- **Rule-based** — combina exceções previstas de antemão (código de teste, janela
  de manutenção conhecida, patch sem exploit). Reduz parte do ruído, mas só cobre
  o que alguém já pensou em excepcionar. Um WAF novo na frente de um endpoint, um
  scanner que começa a piscar — nada disso está na lista de exceções até alguém
  perceber o padrão e escrever a regra.

O problema estrutural dos dois é que são **binários**: cada achado é forçado a cair
de um lado, real ou não-real. Quando SAST diz "vulnerável" e DAST diz "não
consigo confirmar, tem um WAF bloqueando", um mecanismo binário tem que descartar
uma das duas evidências — e normalmente descarta silenciosamente, sem registrar
que havia contradição ali.

## A ideia: não forçar o empate

A lógica paraconsistente anotada de dois valores (LPA2v) parte de uma premissa
diferente: para uma proposição P ("este achado é vulnerabilidade real"), existem
dois graus de evidência — favorável (µ) e desfavorável (λ) — e eles não precisam
somar 1. Disso saem dois valores derivados:

- **grau de certeza** `GC = µ − λ`
- **grau de contradição** `GCT = µ + λ − 1`

Quando `GCT` é alto, o sistema não está "incerto" no sentido de faltar dado — está
recebendo sinais fortes e opostos ao mesmo tempo. É exatamente o caso do WAF: SAST
com µ alto (achou o padrão vulnerável no código), DAST com λ alto (tentou explorar
e foi bloqueado). Isso não é ruído para descartar, é um **estado inconsistente**
que merece ser marcado como tal.

## Arquitetura: neurônios especializados + um neurônio mestre

O cluster hierárquico que implementei tem um neurônio paraconsistente por domínio
de evidência — SAST, SCA, DAST, contexto de código, contexto operacional — cada
um estimando seu próprio par (µ, λ) a partir dos sinais daquele domínio
(severidade, confiança, alcançabilidade em runtime, disponibilidade de patch,
maturidade de exploit, exposição pública, ambiente de baixo tráfego etc.).

Um neurônio mestre agrega esses pares de duas formas diferentes, para dois
propósitos diferentes:

1. **Média ponderada de µ e λ** entre os domínios — usada para o ranking de
   severidade. Isso é o que decide se um achado é "atenção" ou "crítico".
2. **Maior µ e maior λ entre os detectores primários** (SAST/SCA/DAST) — usada
   especificamente para detectar contradição genuína. Uma média simples aqui
   diluiria a contradição real: se três domínios concordam e um discorda com
   força, a média esconde o desacordo. O máximo não.

Antes de emitir a classificação final (`normal`, `atenção`, `degradação`,
`crítico` ou `inconsistente`), o cluster exige **persistência temporal de três
ticks de scan** — um achado precisa se sustentar ao longo de execuções
consecutivas antes de escalar, o que é o que faz o scanner instável (aquele que
pisca achado/não-achado sem motivo real) parar de gerar ruído sem que ninguém
tenha escrito uma regra específica para ele.

## O simulador e os números

Para testar a arquitetura sem depender de um pipeline real logo de cara, escrevi
um simulador em TypeScript: 206 ativos sintéticos distribuídos em doze cenários
representativos (migração de dependências com ruído esperado, endpoint atrás de
WAF, vazamento de segredo progressivo, janela de pentest autorizada, scanner
instável, RCE confirmado, SQL injection em rede interna, entre outros),
totalizando 3.005 eventos.

Comparando os três mecanismos no mesmo cenário simulado:

| Mecanismo | Precisão | Recall | Falsos positivos |
|---|---|---|---|
| Threshold | 8,0% | 86,8% | 2.493 |
| Rule-based | 10,4% | 86,8% | 1.868 |
| **Cluster LPA2v** | **100%** | **65,6%** | **0** |

![Precisão, recall e F1-score por mecanismo: threshold em 8%, rule-based em 10,4% e cluster LPA2v em 100% de precisão](/img/lpa2v/pt/metrics.png)

Os falsos positivos foram de 2.493 (threshold) para zero — e essa redução não
veio de suprimir alertas às cegas: o cluster ainda capturou 164 dos 250 casos
positivos simulados. O custo real foi recall: caiu de 86,8% para 65,6%,
concentrado deliberadamente em três cenários adversos — evidência vinda de um
único domínio, vazamento progressivo com sinal fraco no início, e o período de
aquecimento da própria persistência temporal (o mecanismo que segura o
ruído também atrasa a primeira detecção real).

![Volume de verdadeiros positivos, falsos positivos e falsos negativos por mecanismo: os falsos positivos caem de 2.493 no threshold para 0 no cluster LPA2v](/img/lpa2v/pt/error-volume.png)

No cenário do endpoint atrás de WAF, os 300 eventos foram classificados como
`inconsistente` em 100% dos casos — nem confirmado, nem descartado — enquanto
threshold e rule-based classificaram a totalidade como degradação: uma falsa
confiança consistente, do tipo que ensina o time a ignorar a fila.

![Mapa de calor ativo por tempo no cenário waf-shield: threshold e rule-based em azul sólido (degradação), cluster LPA2v em roxo sólido (inconsistente)](/img/lpa2v/pt/heatmap-waf.png)

No cenário de scanner instável, o mesmo padrão aparece de outro jeito: threshold
e rule-based espalham classificações de atenção/degradação de forma dispersa e
imprevisível entre ativos e ticks, enquanto o cluster LPA2v concentra a
classificação em um único estado (`normal`) ao longo de toda a grade.

![Mapa de calor ativo por tempo no cenário flaky-scanner: threshold e rule-based dispersos entre atenção e degradação, cluster LPA2v uniformemente normal](/img/lpa2v/pt/heatmap-flaky.png)

## Validando contra achados reais (sem recalibrar nada)

Simulação sintética prova que a lógica funciona no papel. Para saber se ela
sobrevive a dados reais, apliquei o mesmo cluster — sem ajustar peso ou limiar
algum — a 559 achados reais de SAST/SCA/DAST coletados de cinco aplicações: duas
plataformas SaaS internas (nexo e steel, mesma stack Next.js), dois projetos open
source de peso (freeCodeCamp e Plane) e meu próprio site pessoal. Rodei Semgrep,
Snyk e OWASP ZAP localmente contra cada uma, e rotulei a verdade de cada achado
por revisão humana assistida por IA — nunca pela severidade autorreportada da
própria ferramenta, porque "falso positivo" só existe em relação a uma realidade
externa ao scanner.

Resultado combinado:

| Mecanismo | Precisão | Recall |
|---|---|---|
| Threshold | 31,7% | 100% |
| Rule-based | 34,2% | 100% |
| **Cluster LPA2v** | **86,8%** | **74,6%** |

![Precisão, recall e F1-score por mecanismo nos 559 achados reais combinados: cluster LPA2v em 86,84% de precisão contra 31,66%–34,17% dos outros dois](/img/lpa2v/pt/real-data-metrics.png)

Sem nenhuma recalibração, o padrão da simulação se confirmou: precisão muito
acima dos mecanismos convencionais, com um custo de recall concentrado. A
precisão ficou acima de 97% em três dos cinco repositórios.

## Onde quebrou — e por que isso importa mais que os números bons

O ponto mais fraco do estudo é o recall no repositório Plane: **33,3%**, contra
100% do threshold. O cluster perdeu 8 das 12 vulnerabilidades reais rotuladas
ali. Investigando a causa: são achados do mesmo padrão (validação de senha
ausente em fluxos Django, severidade moderada vinda de uma única fonte) — e
evidência de um único domínio com severidade moderada é estruturalmente diluída
pela média ponderada entre os demais domínios silenciosos. O mesmo padrão
explica um caso pontual em nexo: duas vulnerabilidades reais em uma lib de
processamento de imagem (sharp, CVSS 7,0) ficaram no grau de certeza 0,14 contra
um limiar de 0,15 — perdidas por uma margem que não é acidente de dados, é
consequência direta de como o neurônio mestre agrega.

Não recalibrei a fórmula para corrigir isso — ficou registrado como direção
concreta para trabalho futuro, junto com a calibração adaptativa dos pesos a
partir dos 559 achados já rotulados (hoje eles são definidos manualmente, não
aprendidos).

## O que isso prova, e o que não prova

A arquitetura não elimina os scanners nem seus limiares de severidade — SAST,
SCA e DAST continuam rodando exatamente como antes. O que muda é o papel deles:
deixam de ser a decisão final e passam a compor um conjunto de evidências que
pode, legitimamente, se contradizer. Isso é o que permite diferenciar um
scanner instável de uma vulnerabilidade real sem escrever uma regra para cada
caso, e marcar um estado inconsistente como inconsistente em vez de forçá-lo
para um lado.

É uma camada de correlação contextual sobre os scanners que já existem, não um
substituto para eles — e o trade-off de recall que ela introduz é real, mensurável,
e concentrado nos lugares exatos onde a evidência é fraca e vem de uma fonte só.
