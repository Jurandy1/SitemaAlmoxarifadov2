/**
 * Copia os anexos dos pedidos (Firebase Storage) para o bucket "pedidos-materiais" do Supabase
 * e atualiza requisicoes.storage_path com o novo caminho. A URL antiga continua em raw.fileURL.
 * Rodar depois de carregar-supabase.mjs (a carga recoloca os caminhos antigos).
 *
 * Uso:
 *   node --env-file=.env.local scripts/supabase/migrar-anexos.mjs
 */
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'pedidos-materiais';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ex.: node --env-file=.env.local ...).');
  process.exit(1);
}

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

const res = await fetch(
  `${SUPABASE_URL}/rest/v1/requisicoes?select=id,firestore_id,file_url,storage_path&file_url=not.is.null&deleted=eq.false`,
  { headers },
);
const pedidos = await res.json();
console.log(`${pedidos.length} pedido(s) ativos com anexo.`);

let copiados = 0;
let indisponiveis = 0;
for (const p of pedidos) {
  const nome = String(p.storage_path || '').split('/').pop() || `${p.firestore_id}.bin`;
  const destino = `${p.firestore_id}/${nome}`;

  const origem = await fetch(p.file_url);
  if (!origem.ok) {
    indisponiveis++;
    console.log(`  ✗ ${p.firestore_id}: arquivo não existe mais no Firebase (${origem.status})`);
    continue;
  }
  const corpo = Buffer.from(await origem.arrayBuffer());
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(destino)}`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': origem.headers.get('content-type') || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: corpo,
  });
  if (!up.ok) throw new Error(`Upload falhou (${destino}): ${up.status} ${await up.text()}`);

  const upd = await fetch(`${SUPABASE_URL}/rest/v1/requisicoes?id=eq.${p.id}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ storage_path: `${BUCKET}/${destino}`, file_url: null }),
  });
  if (!upd.ok) throw new Error(`Atualização falhou (${p.firestore_id}): ${upd.status} ${await upd.text()}`);
  copiados++;
}

console.log(`\nCopiados: ${copiados} | Indisponíveis no Firebase: ${indisponiveis}`);
process.exit(0);
