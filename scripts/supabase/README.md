# Migração Firebase → Supabase (piloto)

## O que já foi criado

| Arquivo | Função |
|---|---|
| `scripts/supabase/inventario-firestore.mjs` | Conta docs e estima MB do Firestore |
| `scripts/supabase/export-firestore.mjs` | Exporta coleções em JSONL |
| `scripts/supabase/gerar-sql-carga.mjs` | Gera SQL de carga (unidades, hist, materiais) |
| `scripts/supabase/001_schema.sql` | Schema Postgres + views + RPC de relatório + RLS |
| `js/services/supabase-config.js` | URL/anon key |
| `js/services/supabase-service.js` | Cliente e queries iniciais |
| `js/reports/report-filters.js` | Contrato de filtros |
| `js/reports/report-query.js` | Motor de relatório (Supabase ou cache Firebase) |

## Passo a passo

### 1) Inventário do banco atual

```powershell
$env:FB_EMAIL="seu@email.com"
$env:FB_PASSWORD="sua-senha"
node scripts/supabase/inventario-firestore.mjs
```

Saída em `scripts/supabase/out/inventario-firestore.json`.

### 2) Criar projeto no Supabase (Free)

1. Acesse https://supabase.com/dashboard
2. Crie um projeto (ex.: `semcas-almox-piloto`)
3. Em **SQL Editor**, rode `scripts/supabase/001_schema.sql`
4. Em **Project Settings → API**, copie:
   - Project URL → `VITE_SUPABASE_URL`
   - anon public key → `VITE_SUPABASE_ANON_KEY`

### 3) Exportar e carregar dados

```powershell
$env:FB_EMAIL="seu@email.com"
$env:FB_PASSWORD="sua-senha"
node scripts/supabase/export-firestore.mjs
node scripts/supabase/gerar-sql-carga.mjs
```

Depois rode no SQL Editor o arquivo gerado:

`scripts/supabase/out/002_carga_piloto.sql`

### 4) Ligar o app no piloto (ainda não troca o Firebase)

Instale o cliente:

```powershell
npm install @supabase/supabase-js
```

Crie `.env.local` (não versionar):

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_DATA_BACKEND=firebase
```

Quando o piloto estiver validado, mude para:

```
VITE_DATA_BACKEND=supabase
```

### 5) Relatório de teste no SQL

```sql
select * from public.report_itens_por_unidade('2026-01-01', '2026-12-31', null, null)
limit 50;
```

## Decisão de plano

- **Free**: ok para piloto e desenvolvimento.
- **Pro (~US$ 25/mês)**: recomendado na virada de produção (backup diário + sem pausa após 7 dias).

## Importante

- Não apague o Firestore até reconciliar totais.
- `service_role` nunca vai no frontend.
- O app continua no Firebase até `VITE_DATA_BACKEND=supabase`.
