/**
 * Enriquece lotacoes_de_para.json com tipo_sistema, ordem_grupo e sigla.
 */
import fs from 'fs';

const path = process.argv[2] || 'c:/Users/PC/Desktop/BATIMENTO DE COMPRAS/lotacoes_de_para.json';
const j = JSON.parse(fs.readFileSync(path, 'utf8'));

const GRUPO_ORDEM = [
  'Gabinete da Secretária',
  'SUP I — SGSUAS',
  'SUP II — Proteção Social Básica',
  'SUP III — PSE Média Complexidade',
  'SUP IV — PSE Alta Complexidade',
  'SUP V — SGBSTR',
  'SUP VI — SAI',
  'SUP VII — Administração',
  'SUP VIII — SEOFC',
  'Órgãos Vinculados',
  'Sede — Lotações Operacionais',
  'Unidades Externas',
  'Sistema',
];

const TIPO_FROM_ANTIGO = {
  ABRIGO: 'ABRIGO',
  'CENTRO POP': 'CENTRO POP',
  CONSELHO: 'CONSELHO',
  COORDENAÇÕES: 'SEDE',
  CRAS: 'CRAS',
  CREAS: 'CREAS',
  CT: 'CT',
  OUTROS: 'OUTROS',
  SEDE: 'SEDE',
  SISTEMA: 'SISTEMA',
  'UNIDADE EXTERNA': 'UNIDADE EXTERNA',
};

function extractSigla(nomeNovo, nomeAntigo) {
  const m = String(nomeNovo || '').match(/\(([A-Z0-9./-]{2,16})\)\s*$/);
  if (m) return m[1];
  const m2 = String(nomeNovo || '').match(/^([A-Z]{2,8})\s*[—–-]/);
  if (m2) return m2[1];
  const bracket = String(nomeAntigo || '').match(/\[([^\]]+)\]/);
  if (bracket) return bracket[1].replace(/\s+/g, '').toUpperCase();
  return '';
}

function resolveTipo(row) {
  let tipo = TIPO_FROM_ANTIGO[row.grupo_antigo] || 'OUTROS';
  if (/creas/i.test(row.nome_novo) || /creas/i.test(row.nome_antigo)) tipo = 'CREAS';
  if (/^CT\s/i.test(row.nome_novo) || row.grupo_antigo === 'CT') tipo = 'CT';
  if (/^CRAS\s/i.test(row.nome_novo) || row.grupo_antigo === 'CRAS') tipo = 'CRAS';
  if (row.grupo_antigo === 'ABRIGO') tipo = 'ABRIGO';
  if (row.grupo_antigo === 'CENTRO POP') tipo = 'CENTRO POP';
  if (
    row.grupo_antigo === 'CONSELHO' ||
    /^CMD/i.test(row.nome_novo) ||
    /^CMAS/i.test(row.nome_novo)
  ) {
    tipo = 'CONSELHO';
  }
  if (row.grupo_antigo === 'UNIDADE EXTERNA') tipo = 'UNIDADE EXTERNA';
  if (row.grupo_antigo === 'SISTEMA') tipo = 'SISTEMA';
  if (row.id_antigo === 'MSE [SEDE]' || /Medidas em Meio Aberto/i.test(row.nome_novo)) {
    tipo = 'UNIDADE EXTERNA';
  }
  if (row.id_antigo === 'SUBPREFEITURA [ESTIVA]') tipo = 'CRAS';
  return tipo;
}

j.metadata = {
  ...j.metadata,
  descricao:
    'Mapeamento de lotações — nome antigo (sistema) → nome oficial + tipo operacional + grupo de lotação (organograma)',
  atualizado_em: '2026-07-21',
  grupos_ordem: GRUPO_ORDEM,
  campos: {
    tipo_sistema: 'Tipo operacional do app (CRAS, CREAS, CT, ABRIGO, SEDE...)',
    grupo_novo: 'Lotação no organograma SEMCAS — agrupamento nos selects',
    ordem_grupo: 'Ordem de exibição do grupo',
    sigla: 'Sigla curta para busca/localização',
  },
};

j.mapeamento = j.mapeamento.map((row) => {
  const ordem_grupo = GRUPO_ORDEM.indexOf(row.grupo_novo);
  return {
    ...row,
    tipo_sistema: resolveTipo(row),
    ordem_grupo: ordem_grupo >= 0 ? ordem_grupo : 99,
    sigla: extractSigla(row.nome_novo, row.nome_antigo) || row.sigla || '',
  };
});

j.mapeamento.sort(
  (a, b) => a.ordem_grupo - b.ordem_grupo || a.nome_novo.localeCompare(b.nome_novo, 'pt-BR')
);

fs.writeFileSync(path, JSON.stringify(j, null, 2) + '\n', 'utf8');

const tipos = {};
const grupos = {};
for (const x of j.mapeamento) {
  tipos[x.tipo_sistema] = (tipos[x.tipo_sistema] || 0) + 1;
  grupos[x.grupo_novo] = (grupos[x.grupo_novo] || 0) + 1;
}
console.log('OK', j.mapeamento.length, 'itens');
console.log('tipos_sistema', tipos);
console.log('grupos', grupos);
