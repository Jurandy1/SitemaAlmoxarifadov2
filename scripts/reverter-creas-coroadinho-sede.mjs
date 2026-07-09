/**
 * Reverte consolidação errada de Creas Coroadinho (CREAS ≠ SEDE).
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore';

const APPLY = process.argv.includes('--apply');
const BASE = 'artifacts/default-app-id/public/data';
const SEDE_ID = 'hW4kseVbfnNDHlBm4wt7';

const firebaseConfig = {
  apiKey: 'AIzaSyD7VCxaHo8veaHnM8RwY60EX_DEh3hOVHk',
  authDomain: 'controle-almoxarifado-semcas.firebaseapp.com',
  projectId: 'controle-almoxarifado-semcas',
  storageBucket: 'controle-almoxarifado-semcas.firebasestorage.app',
  messagingSenderId: '916615427315',
  appId: '1:916615427315:web:6823897ed065c50d413386',
};

const email = process.env.FB_EMAIL;
const password = process.env.FB_PASSWORD;
if (!email || !password) process.exit(1);

const app = initializeApp(firebaseConfig);
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getFirestore(app);

const ref = doc(db, `${BASE}/unidades`, SEDE_ID);
const snap = await getDoc(ref);
if (!snap.exists()) {
  console.error('Unidade SEDE não encontrada:', SEDE_ID);
  process.exit(1);
}

const u = snap.data();
console.log('Estado atual Creas Coroadinho (SEDE):');
console.log('  nome:', u.nome || u.unidadeNome);
console.log('  tipo:', u.tipo);
console.log('  atendeMateriais:', u.atendeMateriais);
console.log('  duplicataDe:', u.duplicataDe || '-');

if (!APPLY) {
  console.log('\n⚠️  Simulação. Use --apply para reativar.');
  process.exit(0);
}

await updateDoc(ref, {
  atendeMateriais: true,
  atendeAgua: true,
  atendeGas: true,
  duplicataDe: deleteField(),
  nomeCanonico: deleteField(),
  observacao: deleteField(),
});

console.log('\n✅ Creas Coroadinho (SEDE) reativado no cadastro.');

// Remover alias que fundia os dois (se existir chave exata)
const aliasRef = doc(db, `${BASE}/semcasAliases`, 'config');
const aliasSnap = await getDoc(aliasRef);
if (aliasSnap.exists()) {
  const aliases = { ...(aliasSnap.data()?.aliases || {}) };
  const creasKey = Object.keys(aliases).find((k) => k === 'CREAS COROADINHO');
  // Não remover alias genérico CREAS COROADINHO — aponta para CREAS, correto para planilhas CREAS
  console.log('Alias CREAS COROADINHO mantido →', aliases[creasKey] || '(não definido)');
}

console.log('Nota: CREAS e SEDE são unidades distintas com o mesmo nome.');
