# Fonte única operacional e projeções fiscais

## Mapa de leitura

| Área | Fonte canônica | Resultado derivado aceito |
| --- | --- | --- |
| Cadastro e pendências de fornecedor | `parceiros` por empresa, tipo e CNPJ | nenhum; exceção só em decisão versionada do movimento |
| Cadeia de fornecedores/clientes | `movimentos` + `parceiros` | `consolidacaoOficial`, condicionado a `projecoes_movimentos_estado` |
| Impacto CBS, diagnóstico e relatório | os mesmos fatos | consolidação oficial, com linha vencida fora dos totais |
| Créditos CBS por item e documento | os mesmos fatos | fotografia ativa apenas para estado `ATUAL` |
| Perfil CBS | os mesmos fatos | materialização que aceita somente projeções `ATUAL` |
| Precificação e formação de custo | vínculo comercial canônico | resultado do motor bloqueado se a projeção não estiver `ATUAL` |
| Impacto de contratos | movimento e contraparte canônicos | soma somente resultado com projeção `ATUAL` |

JSON de evidência, cache de processo, checkpoint de fila ou fotografia do motor
não são fonte de verdade para regime ou classificação. Eles apenas explicam
origem, estado ou cálculo.

## Regra de precedência

1. `movimentos` é o fato fiscal imutável naquilo que veio do documento ou da importação: identificação, valor, período, item, NCM/NBS, CFOP e tributos documentados.
2. `parceiros` é a fonte canônica da identidade atual do parceiro por `(empresa_id,tipo,cnpj)`, incluindo o regime cadastral atual.
3. Uma decisão humana que seja excepcional para um movimento não altera a regra do parceiro silenciosamente: é registrada em `movimento_decisoes_fiscais`, com origem, versão e vigência. Enquanto vigente, ela tem precedência apenas para aquele movimento.
4. `movimentos.regime` não é uma segunda verdade de cadastro. Depois da migração, será uma fotografia histórica com `regime_fonte`, `regime_versao` e `regime_confirmado_em`; sem esses metadados, é legado e não vence `parceiros` nem uma decisão explícita.
5. `motor_resultados_operacionais` é resultado derivado, nunca fonte de cadastro. Só é vigente quando sua assinatura de origem coincide com a projeção persistida do movimento.
6. JSONs (`normalizacao_evidencia`, `dados`, `detalhe`) são evidência e compatibilidade. Não definem precedência por si só.

## Contrato de leitura

Para cada movimento, o resolvedor único devolve uma destas situações:

- `ATUAL`: resultado calculado corresponde à versão canônica.
- `ATUALIZACAO_PENDENTE`: decisão canônica já é exibida; valor derivado aguarda o job incremental.
- `FALHOU`: decisão canônica é exibida; a última fotografia fica identificada como histórica e não vigente.
- `PENDENCIA_REAL`: falta uma decisão ou regra canônica suficiente.

Nenhuma tela analítica pode apresentar resultado de `ATUALIZACAO_PENDENTE` ou `FALHOU` como situação atual.

## Eventos

O evento operacional representa somente alteração observável de negócio. Atualizações técnicas, leituras, leases, checkpoints, tentativas, cache, `updated_at` e regravação idêntica não geram evento. Cada evento possui chave de idempotência composta pela entidade, versão canônica e alteração semântica.
