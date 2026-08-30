"""Extrai somente os PDFs oficiais CST/cClassTrib de 22/06/2026.

O PDF é a prova primária: cada registro preserva página, coordenada e campos
originais. Este script não normaliza significado tributário.
"""
import hashlib, json, re, sys
import pdfplumber

def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest().upper()

def words_cell(words, a, b, top, bottom):
    return ' '.join(w['text'] for w in words if a <= w['x0'] and w['x1'] <= b and top <= w['top'] < bottom).strip()

def at_x(words, x, top, tolerance=2.2):
    candidatos=[w for w in words if abs(w['top']-top)<.06 and abs(w['x0']-x)<=tolerance]
    if not candidatos: return ''
    return min(candidatos,key=lambda w:abs(w['x0']-x))['text'].strip()

def extract_cst(path):
    rows=[]
    with pdfplumber.open(path) as pdf:
        for page_no,page in enumerate(pdf.pages,1):
            table=page.extract_table() or []
            for idx,row in enumerate(table[1:],1):
                if not row or not re.fullmatch(r'\d{3}',(row[0] or '').strip()): continue
                values=[(x or '').strip() for x in row]
                if len(values)!=10: raise ValueError(f'CST: colunas inesperadas página {page_no}, linha {idx}')
                rows.append({'pagina_origem':page_no,'linha_origem':idx,'codigo':values[0],'descricao':values[1],
                    'ind_gibs_cbs':values[2],'ind_gibs_cbs_mono':values[3],'ind_gred':values[4],'ind_gdif':values[5],
                    'ind_gtransf_cred':values[6],'ind_gcred_pres_ibs_zfm':values[7],'ind_gajuste_compet':values[8],'ind_redutor_bc':values[9],
                    'campos_origem':{'arquivo':'cClassTrib 2026-06-22 (1)_CST.pdf','nomes_oficiais':['CST-IBS/CBS','Descrição CST-IBS/CBS','ind_gIBSCBS','ind_gIBSCBSMono','ind_gRed','ind_gDif','ind_gTransfCred','ind_gCredPresIBSZFM','ind_gAjusteCompet','ind_RedutorBC'],'valores':values}})
    return rows

def extract_cclass(path):
    rows=[]
    # limites textuais iniciais; flags de DF-e usam as coordenadas fixas do próprio PDF.
    bounds=[38,46,63,72,104,158,218,229,289,348,362,374,386,398,410,421,432,444,455,466,478,486,498,508,520]
    names=['cst_codigo_origem','cst_descricao_origem','codigo','nome','descricao','lc_redacao','lc_214_25','regulamento_cbs','regulamento_ibs','tipo_aliquota','pred_ibs','pred_cbs','ind_gtrib_regular','ind_gcred_pres_op','ind_gmono_padrao','ind_gmono_reten','ind_gmono_ret','ind_gmono_dif','ind_gp_bio_diferente','ind_gestorno_cred','tp_rbsn','vigencia_inicio','vigencia_fim','data_atualizacao']
    dfe=[('ind_nfe_abi',523.25),('ind_nfe',534.56),('ind_nfce',545.87),('ind_cte',557.18),('ind_cte_os',568.49),('ind_bpe',579.80),('ind_bpe_ta',591.11),('ind_bpe_tm',602.42),('ind_nf3e',613.73),('ind_nfse',625.04),('ind_nfse_via',636.35),('ind_nfcom',647.66),('ind_nfag',658.97),('ind_nfgas',670.28),('ind_dere',681.59),('ind_dir',692.90),('ind_duimp',704.21)]
    with pdfplumber.open(path) as pdf:
        for page_no,page in enumerate(pdf.pages,1):
            words=page.extract_words(use_text_flow=True,keep_blank_chars=False)
            starts=sorted({round(w['top'],2) for w in words if 62<=w['x0']<=72 and re.fullmatch(r'\d{6}',w['text'])})
            for line_no,top in enumerate(starts,1):
                end=starts[line_no] if line_no<len(starts) else page.height
                data={name:words_cell(words,bounds[i],bounds[i+1],top,end) for i,name in enumerate(names)}
                # Campos escalares têm posição fixa; leitura pontual evita que uma
                # descrição longa da linha anterior invada o registro seguinte.
                for nome,x in [('tipo_aliquota',343.86),('pred_ibs',364.13),('pred_cbs',375.44),
                               ('ind_gtrib_regular',386.75),('ind_gcred_pres_op',398.06),('ind_gmono_padrao',409.37),
                               ('ind_gmono_reten',420.68),('ind_gmono_ret',431.99),('ind_gmono_dif',443.30),
                               ('ind_gp_bio_diferente',455.39),('ind_gestorno_cred',466.70),('tp_rbsn',478.01)]:
                    valor=at_x(words,x,top)
                    if valor: data[nome]=valor
                if 'Padr' in data['tipo_aliquota']:
                    data['tipo_aliquota']='Padrão'
                data.update({name:at_x(words,x,top) for name,x in dfe})
                data['anexo']=words_cell(words,713,721,top,end)
                data['link_fonte']=words_cell(words,721,792,top,end)
                data['pagina_origem']=page_no; data['linha_origem']=line_no; data['coordenada_y']=top
                if not re.fullmatch(r'\d{6}',data['codigo']): raise ValueError(f"cClassTrib inválido p{page_no} y{top}: {data['codigo']!r}")
                obrigatorios=['cst_codigo_origem','tipo_aliquota','pred_ibs','pred_cbs','ind_gtrib_regular','ind_gcred_pres_op','ind_gmono_padrao','ind_gmono_reten','ind_gmono_ret','ind_gmono_dif','ind_gp_bio_diferente','ind_gestorno_cred','tp_rbsn','vigencia_inicio','data_atualizacao']+[n for n,_ in dfe]
                ausentes=[n for n in obrigatorios if not data[n]]
                if ausentes: raise ValueError(f"cClassTrib p{page_no} código {data['codigo']} sem campos oficiais: {ausentes}")
                data['campos_origem']={'arquivo':'cClassTrib 2026-06-22 (1).pdf','pagina':page_no,'coordenada_y':top,'metodo':'COORDENADAS_PDF_OFICIAL','nomes_oficiais':names+[n for n,_ in dfe]+['ANEXO','Link'],'valores':{k:data[k] for k in names+[n for n,_ in dfe]+['anexo','link_fonte']}}
                rows.append(data)
    codigos=[r['codigo'] for r in rows]
    if len(codigos)!=len(set(codigos)): raise ValueError('cClassTrib duplicado no PDF oficial')
    return rows

if __name__=='__main__':
    cst,cclass=sys.argv[1:3]
    result={'cst':extract_cst(cst),'cclasstrib':extract_cclass(cclass),'hashes':{'cst':sha(cst),'cclasstrib':sha(cclass)}}
    print(json.dumps(result,ensure_ascii=False))
