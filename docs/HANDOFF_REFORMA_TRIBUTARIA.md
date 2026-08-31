# HANDOFF — SATTVA | IMPLEMENTAÇÃO DA REFORMA TRIBUTÁRIA

**Fonte de verdade operacional para continuidade do desenvolvimento.**  
**Referência:** 31/08/2026 · **Último commit estrutural:** `20dc2c5` · **Próxima frente:** evidência de carga de fornecedores MEI.

## Princípios imutáveis

- Supabase/PostgreSQL é a fonte compartilhada e persistente. SQLite é cache local, nunca autoridade fiscal.
- Há um único motor fiscal; `motor_resultados_operacionais` é a verdade operacional persistida. Não criar motor, cálculo ou resultado concorrente.
- `movimentos` preserva fato/documento; classificação resolvida e resultado fiscal são camadas separadas.
- Telas e relatórios consomem os mesmos resultados, sem reconstrução paralela.
- Estados: `REAL`, `CALCULADO`, `SIMULADO`, `INTERPRETADO`, `SUGERIDO`, `INDETERMINADO`, `INCOMPLETO`.
- `INDETERMINADO` nunca vira zero silenciosamente.

## Baseline fiscal validado

Empresa piloto: **Truston**. Execução oficial: **14**.

```ini
TOTAL_RESULTADOS = 816
CBS = R$ 172.258,23
```

Para alteração fiscal/persistente, validar os mesmos totais antes/depois. Não repetir essa regressão em tarefa somente leitura sem motivo.

## Autonomia — Etapa 3D

As métricas são dimensões independentes; não colapsá-las novamente:

```ini
AUTONOMIA_CALCULO_CBS_PROPRIA = 83,82%
AUTONOMIA_CREDITO_ENTRADA = 64,71%
AUTONOMIA_CREDITO_CLIENTE = 96,82%
AUTONOMIA_CLASSIFICATORIA = 91,91%
AUTONOMIA_DIAGNOSTICO_COMPLETO = 89,46%
AUTONOMIA_GLOBAL_LEGADA = preservada
```

Commit: `df3b963`.

Crédito potencial/aproveitamento do cliente não bloqueia o débito CBS próprio de uma saída. Uma saída pode ter CBS própria determinada, crédito do cliente sujeito à validação, classificação parcial e diagnóstico completo incompleto. A Etapa 3C comprovou 20 saídas; a implementação genérica 3D liberou 21 sem IDs Truston hardcoded.

## NBS, NCM e equivalência tributária

Código do documento é fato histórico, não classificação automaticamente correta. Divergência classificatória só é material se mudar tratamento tributário.

Múltiplas NBS não exigem ação humana quando LC116 é confiável e todas as assinaturas tributárias materiais são equivalentes: cálculo automático permitido, classificação parcial preservada e nenhuma NBS escolhida arbitrariamente.

```ini
LC116 0105 = EQUIVALENTE_FISCALMENTE
LC116 0107 = EQUIVALENTE_FISCALMENTE
LC116 1401 = DIVERGENTE_FISCALMENTE
LC116 1702 = EQUIVALENTE_FISCALMENTE
TOTAL_ANALISADO = 85
EQUIVALENCIA_NBS_COMPROVADA = 83
CONFLITO_NBS_COMPROVADO = 2
```

LC116 1401 exige tratamento especial.

## Catálogos e cadastro mestre

`base_servicos`: 1.739 linhas; lineage recuperado em 1.735 (99,77%), com quatro pendências indistinguíveis na versão utilizada. Commit: `108a133`.

CST/cClassTrib oficiais de 22/06/2026 estão `VALIDADA`, não ativos:

```ini
CST = 18
cClassTrib = 164
RELAÇÕES_CST_CCLASSTRIB = 164
HASH_CST = 50223469835D8B37036FD99FF634F5E881EEB17269A29DAB4DAFDF9DDAE3876F
HASH_CCLASSTRIB = FE0E2C900D537293D50CD768621393D9AADDCCE7A9560064686E8D2EBE9A628D
ASSINATURAS_CBS_SHADOW = 1.723
```

Commit: `4064503`.

Cadastro mestre: 895 registros, sem `codigo_interno`, 197 serviços únicos estimados e 698 duplicidades. Não inferir vínculo histórico por descrição. Para documentos novos, a chave é `empresa_id + codigo_servico_interno`.

## Precedências

PIS/Cofins: `documento/SPED → regra específica → referência empresa/item → regime → premissa → INDETERMINADO`. Lucro Real 9,25% e Lucro Presumido 3,65% são fallback, não regra absoluta.

Regime CNPJ: `API_SIMPLES > RFB_2024 > MANUAL > INDETERMINADO`.

Crédito Simples a 2,5%, quando sem evidência real, é `SIMULADO/PREMISSA`. Crédito sempre diferencia `DETERMINADO`, `ZERO_COMPROVADO` e `INDETERMINADO`.

## Gargalo e próxima ação

```ini
ENTRADAS_COM_PIS_COFINS_ZERO_NAO_CONCLUSIVO_E_CREDITO_SUJEITO_VALIDACAO = 58
ENTRADAS_COM_REGRA_CONDICAO_DE_CREDITO_INSUFICIENTE = 6
```

PIS/Cofins zero persistido não prova zero fiscal. Não concluir isenção/sem crédito sem CST, base, alíquota, tratamento e natureza do crédito.

### Etapa 3E — SCAN

Agrupar as 58 entradas exclusivamente por fonte necessária: XML/DF-e, EFD-Contribuições, cadastro fiscal, regra específica ou outra fonte. Retornar quantidade, campos faltantes, chave de correlação e fonte capaz de resolver. Não reauditar NBS, LC116, CST/cClassTrib, autonomia geral ou execução inteira. Sem implementação nesta etapa.

EFD deve correlacionar documento/item/competência/participante de modo determinístico, usando A100/A170, C100/C170 ou registro aplicável.

## Disciplina de execução

Truston é piloto: nunca hardcodar empresa, IDs, regras ou percentuais. Usar `empresa_id`, `projeto_id`, `execucao_id` e vigência.

Meta mínima de autonomia segura é 95%; meta ótima é o máximo tecnicamente seguro. Toda nova autonomia exige evidência, regra, versão, catálogo/linha, contexto e hash da decisão.

- **SCAN:** somente leitura, escopo mínimo, sem migration e sem suíte integral.
- **IMPLEMENT:** alteração mínima decidida e testes específicos; regressão se houver impacto fiscal.
- **REGRESSION:** antes de deploy ou mudança estrutural/fiscal sensível.

Formato preferido:

```ini
RESULTADO = ...
QUANTIDADE = ...
BLOQUEIO = ...
PROXIMA_ACAO = ...
```

Não gerar relatório operação a operação sem necessidade; preferir resumo agregado e IDs apenas das exceções.

## Marco de autonomia — Etapas 3F.3 a 3F.8

O marco abaixo é uma fotografia **shadow validada**. A execução oficial 14 não foi reprocessada nem teve sua telemetria histórica sobrescrita nesta sequência; portanto, esta marca não altera resultados fiscais persistidos.

```ini
TOTAL_OPERACOES = 816
DIAGNOSTICO_COMPLETO_AUTONOMO_SOMBRA = 781
DIAGNOSTICO_COMPLETO_NAO_AUTONOMO_SOMBRA = 35
AUTONOMIA_DIAGNOSTICO_COMPLETO_SOMBRA = 95,71%
META_MINIMA_95 = ATINGIDA

MEI_SEM_EVIDENCIA_CARGA_FORNECEDOR = 35
OUTROS_RESIDUAIS = 0

EXECUCAO_OFICIAL_PRESERVADA = 14
RESULTADOS_FISCAIS_OFICIAIS = 816
CBS_OFICIAL = R$ 172.258,23
```

As liberações em shadow decorrem de: crédito do cliente que não pode ser bloqueado por classificação não material (`8c516d7`), equivalência classificatória sem escolha arbitrária de NBS/NCM (`6c477f8`) e propagação dessa equivalência aos resolvedores de regra fiscal e crédito (`20dc2c5`).

A próxima frente, sem início automático, é obter evidência ou uma regra fiscal versionada suficiente para a **carga do fornecedor MEI**. Não substituir ausência de evidência por zero, estimativa ou regra genérica.

## Commits relevantes

```text
696571e  cache Supabase/SQLite + shadow catálogo
1d70656  memória de decisão versionada
3e8e45f  bloqueio de fallback técnico futuro
78f432f  orquestrador de enriquecimento shadow
108a133  retro-link catálogo de serviços
4064503  carga CST/cClassTrib + assinaturas shadow
df3b963  dimensões independentes de autonomia
8c516d7  crédito do cliente após classificação não material
6c477f8  equivalência classificatória não bloqueante
20dc2c5  propagação da equivalência para regra fiscal e crédito
```
