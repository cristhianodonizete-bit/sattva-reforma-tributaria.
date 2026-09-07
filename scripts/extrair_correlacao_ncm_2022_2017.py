"""Extrai, sem interpretar, a tabela oficial MDIC NCM 2017 -> NCM 2022."""
import argparse, hashlib, json, re
import pdfplumber

parser = argparse.ArgumentParser()
parser.add_argument('--arquivo', required=True)
parser.add_argument('--saida', required=True)
args = parser.parse_args()

with open(args.arquivo, 'rb') as arquivo:
    bruto = arquivo.read()
hash_origem = hashlib.sha256(bruto).hexdigest()
relacoes = []
with pdfplumber.open(args.arquivo) as pdf:
    for pagina, page in enumerate(pdf.pages, start=1):
        destino_atual = None
        for linha in (page.extract_table() or []):
            esquerda, direita = (linha + [None, None])[:2]
            if esquerda and re.search(r'\d{4}\.\d{2}\.\d{2}', esquerda):
                destino_atual = re.sub(r'\D', '', esquerda)
            if not direita or not destino_atual:
                continue
            encontrado = re.search(r'(ex\s+)?(\d{4}\.\d{2}\.\d{2})', direita)
            if not encontrado:
                continue
            origem = re.sub(r'\D', '', encontrado.group(2))
            relacoes.append({
                'codigo_origem': origem,
                'codigo_destino': destino_atual,
                'tipo_relacao': 'PARCIAL_EX' if encontrado.group(1) else 'DIRETA',
                'versao_origem': 'NCM 2017', 'versao_destino': 'NCM 2022',
                'fonte': 'MDIC/Gecex — Tabela de Correlação NCM 2022 | NCM 2017',
                'hash_origem': hash_origem,
                'evidencia': f'Página {pagina}: {direita.strip()}',
            })
unicas = {(x['codigo_origem'], x['codigo_destino'], x['tipo_relacao']): x for x in relacoes}
with open(args.saida, 'w', encoding='utf-8') as saida:
    json.dump({'hash_arquivo': hash_origem, 'fonte': 'MDIC/Gecex — Tabela de Correlação NCM 2022 | NCM 2017', 'relacoes': list(unicas.values())}, saida, ensure_ascii=False, indent=2)
print(json.dumps({'relacoes_extraidas': len(unicas), 'hash_arquivo': hash_origem}, ensure_ascii=False))
