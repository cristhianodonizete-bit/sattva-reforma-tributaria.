# Handoff Final — Sattva | Implementação da Reforma Tributária

## Objetivo do projeto

Disponibilizar uma operação única para receber e tratar dados, executar análises tributárias e apresentar entregáveis com rastreabilidade, sem duplicar motores ou substituir fatos documentais.

## Estado da release

```ini
RELEASE = reforma-tributaria-v1.0
STATUS = APROVADA
EXECUCAO_OFICIAL = 14
RESULTADOS_OFICIAIS = 816
CBS_OFICIAL = R$ 172.258,23
```

## Fases consolidadas

```ini
4A_IMPLANTACAO_POR_ESCOPO = APROVADA
4B_DADOS_ADICIONAIS = APROVADA
4C_PERFIL_TRIBUTARIO_RAIO_X = APROVADA
4C3_APURACOES_PIS_COFINS = IMPLEMENTADA
4D_COMPARADOR_DE_REGIMES = APROVADA
4E_UX_CENTRAL_DE_DADOS = APROVADA
4F_MANUAL_E_GUIA = APROVADA
```

## Principais entregas

- Implantação por escopo, checklist, responsáveis, pendências e acompanhamento.
- Central de Dados para cadastros, planilhas, XML, SPED, documentos de apuração, dados complementares e tratamento de pendências.
- Perfil Tributário, Raio-X Histórico e comparação entre situação anterior e CBS já calculada.
- Comparador de Lucro Real, Lucro Presumido, Simples Nacional e Simples Nacional Híbrido quando os dados são comparáveis.
- Ingestão, revisão humana e rastreabilidade de apurações históricas de PIS/Cofins.
- Manual do Usuário e Guia do Instrutor em `docs/`.

## Operação em alto nível

```text
Central de Dados
  → tratamento e validações
  → motores e análises existentes
  → módulos do produto
  → relatórios e entregáveis
```

Supabase/PostgreSQL é a fonte compartilhada. O cache operacional é descartável e restaurado da fonte compartilhada. Há um único motor fiscal; documentos permanecem fatos históricos e estados ausentes permanecem explícitos.

## Migrations relevantes

```text
20260906_persistencia_efd_contribuicoes.sql
20260907_camada_unificada_evidencia_fiscal.sql
20260908_implantacao_por_escopo.sql
20260909_dados_adicionais_analise_tributaria.sql
20260910_parametros_irpj_csll_comparador.sql
20260911_ingestao_ia_apuracoes_pis_cofins.sql
20260912_matriz_irpj_csll_2026.sql
```

## Commits relevantes

```text
20dc2c5  propagação de equivalência classificatória
f2f3133 cenário Simples Nacional Híbrido
835695c cache operacional e Central de Dados
85741d5 centralização de importações e tratamento
f8b4950 manual do usuário e guia do instrutor
```

## Limitações conhecidas e pendências não bloqueantes

- `PGDAS_IMPORTACAO_PROPRIA = NAO_SUPORTADO_ATUALMENTE`.
- Não há tela operacional própria para cadastros separados de estabelecimentos, produtos, serviços e classificações.
- Não há histórico salvo de cenários.
- A homologação ponta a ponta com documento real de apuração PIS/Cofins permanece pendente, sem bloquear a release.
- A Truston ainda não possui receita por competência, composição/natureza das receitas e margem operacional suficientes para ranking real no comparador. Isso é pendência de dados do cliente, não defeito do produto.

## Continuidade futura

1. Registrar dados faltantes da empresa pela Central de Dados antes de concluir análises incompletas.
2. Tratar novas funcionalidades como fases independentes, preservando dados → tratamento → motores → entregáveis.
3. Não converter ausência de informação em zero e não substituir documento histórico por classificação automática.
4. Antes de qualquer alteração fiscal, validar o baseline oficial acima.
