/**
 * Inventário do Firestore: conta docs, estima tamanho e gera relatório JSON/CSV.
 *
 * Uso (entra como visitante, só leitura; ou defina FB_EMAIL/FB_PASSWORD):
 *   node scripts/supabase/inventario-firestore.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const BASE_PRIMARY = 'artifacts/default-app-id/public/data';
const BASE_LEGACY = 'artifacts/1-916615427315-web-6823897ed065c50d413386/public/data';

const firebaseConfig = {
  apiKey: 'AIzaSyD7VCxaHo8veaHnM8RwY60EX_DEh3hOVHk',
  authDomain: 'controle-almoxarifado-semcas.firebaseapp.com',
  projectId: 'controle-almoxarifado-semcas',
  storageBucket: 'controle-almoxarifado-semcas.firebasestorage.app',
  messagingSenderId: '916615427315',
  appId: '1:916615427315:web:6823897ed065c50d413386',
};

const COLLECTIONS = [
  'unidades',
  'controleAgua',
  'controleGas',
  'controleMateriais',
  'estoqueAgua',
  'estoqueGas',
  'socialCestaMov',
  'socialCestaEstoque',
  'socialEnxovalMov',
  'socialEnxovalEstoque',
  'semcasHistDB',
  'semcasAliases',
  'userRoles',
  'feriados',
  'stats',
  'entregas',
];

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;


function approxBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return 0;
  }
}

async function inventariarBase(db, basePath) {
  const rows = [];
  let totalDocs = 0;
  let totalBytes = 0;

  for (const name of COLLECTIONS) {
    const snap = await getDocs(collection(db, `${basePath}/${name}`));
    let bytes = 0;
    let maxDoc = 0;
    const sampleIds = [];
    for (const d of snap.docs) {
      const size = approxBytes({ id: d.id, ...d.data() });
      bytes += size;
      if (size > maxDoc) maxDoc = size;
      if (sampleIds.length < 3) sampleIds.push(d.id);
    }
    totalDocs += snap.size;
    totalBytes += bytes;
    rows.push({
      basePath,
      collection: name,
      docs: snap.size,
      bytes,
      mb: +(bytes / (1024 * 1024)).toFixed(3),
      maxDocBytes: maxDoc,
      sampleIds,
    });
    console.log(`  ${name.padEnd(24)} ${String(snap.size).padStart(6)} docs  ${(bytes / (1024 * 1024)).toFixed(3)} MB`);
  }

  return { basePath, rows, totalDocs, totalBytes, totalMb: +(totalBytes / (1024 * 1024)).toFixed(3) };
}

const app = initializeApp(firebaseConfig);
// Leitura é liberada para qualquer usuário autenticado (inclusive visitante anônimo)
if (email && password) await signInWithEmailAndPassword(getAuth(app), email, password);
else await signInAnonymously(getAuth(app));
const db = getFirestore(app);

mkdirSync(OUT_DIR, { recursive: true });

console.log('Inventário Firestore\n');
console.log(`Base principal: ${BASE_PRIMARY}`);
const primary = await inventariarBase(db, BASE_PRIMARY);

console.log(`\nBase alternativa: ${BASE_LEGACY}`);
let legacy = null;
try {
  legacy = await inventariarBase(db, BASE_LEGACY);
} catch (e) {
  console.log(`  (indisponível: ${e.message || e})`);
}

const chosen = !legacy || primary.totalDocs >= legacy.totalDocs ? primary : legacy;
const report = {
  generatedAt: new Date().toISOString(),
  chosenBase: chosen.basePath,
  freePlanDbMb: 500,
  freePlanEgressGb: 5,
  primary,
  legacy,
  supabaseFit: {
    dbPctOfFree: +((chosen.totalMb / 500) * 100).toFixed(2),
    yearsAt90MbGrowth: chosen.totalMb > 0 ? +((500 - chosen.totalMb) / 90).toFixed(1) : null,
    note: 'Estimativa de crescimento anual (~90 MB) vem do plano; ajuste após ETL real.',
  },
};

const jsonPath = join(OUT_DIR, 'inventario-firestore.json');
const csvPath = join(OUT_DIR, 'inventario-firestore.csv');
writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
writeFileSync(
  csvPath,
  ['basePath,collection,docs,bytes,mb,maxDocBytes']
    .concat(chosen.rows.map((r) => `${r.basePath},${r.collection},${r.docs},${r.bytes},${r.mb},${r.maxDocBytes}`))
    .join('\n'),
  'utf8'
);

console.log('\n' + '='.repeat(60));
console.log(`Base escolhida: ${chosen.basePath}`);
console.log(`Total docs: ${chosen.totalDocs}`);
console.log(`Tamanho estimado: ${chosen.totalMb} MB`);
console.log(`% do Free (500 MB): ${report.supabaseFit.dbPctOfFree}%`);
console.log(`JSON: ${jsonPath}`);
console.log(`CSV:  ${csvPath}`);
process.exit(0);
