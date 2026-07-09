/** Mapeamentos compartilhados planilha → unidade cadastrada */

export function rmAcc(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function key(s) {
  return rmAcc(s).toUpperCase().replace(/\s+/g, ' ').trim();
}

export function cleanUnitName(raw) {
  return String(raw || '')
    .replace(/\d{1,2}[\/.]\d{1,2}[\/.]?\d{0,4}.*/gi, '')
    .replace(/\bentrega\b.*/gi, '')
    .replace(/\s*[-–—]\s*sa\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** [texto na planilha, nome no cadastro] */
export const MANUAL_RAW = [
  ['CT ANIL BEQUIMÃO', 'Anil/BequimãO'],
  ['CT CENTRO', 'Centro/Alemanha'],
  ['CT ITAQUIBACANGA', 'Itaqui-Bacanga'],
  ['CT ITAQUI-BACANGA', 'Itaqui-Bacanga'],
  ['CT VILA LUIZÃO', 'Vila LuizãO/Turu'],
  ['CRAS VINHAIS', 'Cras Vinhas'],
  ['CRAS TERRITÓRIO 2 – BAIRRO DE FÁTIMA', 'Cras Bairro De Fatima'],
  ['CRAS TERRITORIO 2 BAIRRO DE FATIMA', 'Cras Bairro De Fatima'],
  ['CRAS BAIRRO DE FÁTIMA', 'Cras Bairro De Fatima'],
  ['CRAS BAIRRO DE FATIMA', 'Cras Bairro De Fatima'],
  ['CRAS TERRITÓRIO 18 JANAÍNA', 'Cras Janaina'],
  ['CRAS TERRITORIO 18 JANAINA', 'Cras Janaina'],
  ['CRAS TERRITÓRIO 18', 'Cras Janaina'],
  ['COORDENAÇÃO DE TRANSPORTE', 'Diretoria Técnica De Transporte'],
  ['COORDENACAO DE TRANSPORTE', 'Diretoria Técnica De Transporte'],
  ['SUPERINTENDÊNCIA DE ADMINISTRAÇÃO', 'SuperintendêNcia De AdministraçãO'],
  ['SUPERINTENDENCIA DE ADMINISTRACAO', 'SuperintendêNcia De AdministraçãO'],
  ['SUPERINTENDÊNCIA ADMINISTRATIVA - SA', 'SuperintendêNcia De AdministraçãO'],
  ['SUPERINTENDENCIA ADMINISTRATIVA SA', 'SuperintendêNcia De AdministraçãO'],
  ['CREAS CENTRO', 'Creas Centro'],
  ['CRAS TERRITÓRIO 18 JANAÍNA', 'Cras Janaina'],
  ['CRAS TERRITORIO 18 JANAINA', 'Cras Janaina'],
  ['CRAS TERRITÓRIO 18', 'Cras Janaina'],
  ['SPSB', 'SuperintendêNcia De ProteçãO Social BáSica'],
  ['SPSE - MEDIA COMPLEXIDADE', 'SuperintendêNcia De ProteçãO Social Especial De MéDia Complexidade'],
  ['SPSE - MÉDIA COMPLEXIDADE', 'SuperintendêNcia De ProteçãO Social Especial De MéDia Complexidade'],
  ['TRANSFERÊNCIA DE RENDA-SGBSTR', 'Diretoria Técnica De Cadastro úNico E TransferêNcia De Renda'],
  ['TRANSFERENCIA DE RENDA-SGBSTR', 'Diretoria Técnica De Cadastro úNico E TransferêNcia De Renda'],
  ['TRANSFERÊNCIA DE RENDA', 'Diretoria Técnica De Cadastro úNico E TransferêNcia De Renda'],
];

/** CT pelo nome do arquivo (quando planilha diz só "CONSELHO TUTELAR") */
export const CT_FILE_PATTERNS = [
  { re: /ANIL|BEQUIM/i, target: 'Anil/BequimãO' },
  { re: /CENTRO|ALEMANHA/i, target: 'Centro/Alemanha' },
  { re: /CIDADE\s*OPER|OLIMP/i, target: 'Cidade OperáRia/Cidade OlíMpica' },
  { re: /COHAB|COHATRAC/i, target: 'Cohab/Cohatrac' },
  { re: /COROADINHO|JOAO\s*PAULO|JOÃO\s*PAULO/i, target: 'Coroadinho/JoãO Paulo' },
  { re: /ITAQUI|BACANGA/i, target: 'Itaqui-Bacanga' },
  { re: /FRANCISCO|COHAMA/i, target: 'SãO Francisco/Cohama' },
  { re: /CRISTOV|RAIMUNDO/i, target: 'SãO CristóVãO/SãO Raimundo' },
  { re: /LUIZ|TURU/i, target: 'Vila LuizãO/Turu' },
  { re: /ZONA\s*RURAL/i, target: 'Ct Zona Rural' },
];

export function resolveCtFromFileName(fileName, findRegistered) {
  const fn = rmAcc(fileName || '');
  if (!/\bCT\b/i.test(fn) && !/CONSELHO\s*TUTELAR/i.test(fn)) return null;
  for (const { re, target } of CT_FILE_PATTERNS) {
    if (re.test(fn)) return findRegistered(target);
  }
  return null;
}

export function createResolver(registered, aliases = {}) {
  const registeredKeys = new Set(registered.map(key));
  const manualPrefix = MANUAL_RAW.map(([a, b]) => [key(a), b]);

  function findRegistered(targetName) {
    if (!targetName) return null;
    return registered.find((r) => key(r) === key(targetName)) || null;
  }

  function resolveUnit(raw, fileName = '') {
    if (!raw) return null;
    const seen = new Set();
    const candidates = [];
    for (const c of [String(raw).trim(), cleanUnitName(raw)]) {
      if (!c || seen.has(key(c))) continue;
      seen.add(key(c));
      candidates.push(c);
    }

    for (const s of candidates) {
      const k = key(s);
      const rawIsCreas = k.startsWith('CREAS ');
      const rawIsCras = k.startsWith('CRAS ');

      if (/\bSPSB\b/.test(k)) {
        const hit = findRegistered('SuperintendêNcia De ProteçãO Social BáSica');
        if (hit) return hit;
      }
      if (/\bSPSE\b/.test(k) && /MEDIA/.test(k)) {
        const hit = findRegistered('SuperintendêNcia De ProteçãO Social Especial De MéDia Complexidade');
        if (hit) return hit;
      }

      if (k === 'CONSELHO TUTELAR' || k.startsWith('CONSELHO TUTELAR ')) {
        const fromFile = resolveCtFromFileName(fileName, findRegistered);
        if (fromFile) return fromFile;
      }

      if (aliases[k]) {
        const hit = findRegistered(aliases[k]);
        if (hit) {
          const hitK = key(hit);
          if (rawIsCreas && hitK.startsWith('CRAS ')) continue;
          if (rawIsCras && hitK.startsWith('CREAS ')) continue;
          return hit;
        }
      }

      for (const [prefix, target] of manualPrefix) {
        if (k === prefix || k.startsWith(prefix + ' ') || k.startsWith(prefix)) {
          const hit = findRegistered(target);
          if (hit) return hit;
        }
      }

      if (registeredKeys.has(k)) return findRegistered(s);
    }

    if (fileName) {
      const fromFile = resolveCtFromFileName(fileName, findRegistered);
      if (fromFile) return fromFile;
    }

    return null;
  }

  return { resolveUnit, findRegistered };
}
