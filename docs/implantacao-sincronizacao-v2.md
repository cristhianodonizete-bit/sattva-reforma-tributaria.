# Implantação da sincronização operacional v2

## Estado desta entrega

A migration `20261015_sincronizacao_operacional_v2_homologacao.sql` e o consumidor compatível estão versionados, mas **não foram aplicados no Supabase de produção**. Não há limpeza, retenção automática ou remoção de índice nesta etapa.

## Transição

1. Publicar o código do consumidor. Sem as funções v2, ele continua no protocolo v1.
2. Aplicar a migration v2 em janela controlada. Ela não remove registros e fixa um corte técnico; os eventos anteriores permanecem para auditoria e para consumidores v1.
3. Na primeira execução v2 de cada cache, registrar consumidor e sessão, publicar os eventos já confirmados, executar carga-base da fonte canônica e aplicar somente a sobreposição publicada após o início dessa carga.
4. Confirmar o checkpoint central somente depois do `COMMIT` local. Uma falha entre os dois passos repete eventos, operação idempotente, sem salto.
5. Observar por pelo menos um ciclo operacional completo antes de discutir retenção.

O checkpoint v1 não é convertido. Ele não prova ordem de confirmação de transações concorrentes; por isso a transição v2 faz carga-base atual e usa a fila publicada somente para a sobreposição.

## Critérios de sucesso

- `UPDATE` somente técnico não cria evento.
- Alteração de negócio cria um evento e chega a cada consumidor ativo.
- `sequencia_consumo` é contígua para eventos publicados.
- O checkpoint remoto de cada consumidor só aumenta após aplicação local.
- Segunda sessão do mesmo consumidor recebe erro de lease; consumidores distintos avançam de forma independente.
- Documentos excluídos continuam protegidos pelo registro canônico de exclusão já existente; publicação atrasada não pode recriá-los.

## Observação e rollback

Monitorar por tabela: eventos criados, publicados, consumidos, atraso por consumidor, leases ativos e falhas de confirmação. Não usar `MAX(sequencia)` técnica como progresso de consumo.

Para rollback de aplicação, publicar a versão anterior: ela continua lendo a sequência técnica e todos os eventos de negócio v2 ainda existem na tabela original. Não apagar `sequencia_consumo`, estado ou checkpoints. O retorno à v2 refaz carga-base se necessário. Não executar retenção enquanto houver consumidores v1 ou checkpoints v2 sem cobertura certificada.

## Limitação de homologação local

Esta estação não possui PostgreSQL/Docker local e a produção foi preservada. A suíte `sincronizacao-operacional-v2-fluxo.test.js` homologa deterministicamente o contrato da fila com tabela-probe simulada, inclusive falha, repetição, consumidores, lease e commit invertido. Antes da aplicação em produção, executar a mesma migration e a suíte de fluxo contra um PostgreSQL descartável; nenhum histórico de produção deve ser copiado.
