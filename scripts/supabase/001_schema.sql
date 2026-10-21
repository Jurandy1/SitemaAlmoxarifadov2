-- SEMCAS Almoxarifado — schema inicial Supabase/Postgres
-- Aplicar no SQL Editor do projeto piloto (Free).
-- Não apaga dados do Firestore; esta é a base do piloto.

create extension if not exists "pgcrypto";

-- ─── Perfis / Auth ─────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'editor' check (role in ('admin', 'editor', 'viewer')),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Unidades ──────────────────────────────────────────────────────
create table if not exists public.unidades (
  id uuid primary key default gen_random_uuid(),
  firestore_id text unique,
  nome text not null,
  tipo text not null default 'OUTROS',
  sigla text,
  atende_agua boolean not null default true,
  atende_gas boolean not null default true,
  atende_materiais boolean not null default true,
  ativo boolean not null default true,
  duplicata_de uuid references public.unidades(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists unidades_nome_idx on public.unidades (lower(nome));
create index if not exists unidades_tipo_idx on public.unidades (tipo);

create table if not exists public.aliases_unidades (
  id uuid primary key default gen_random_uuid(),
  alias_key text not null unique,
  alias_raw text,
  unidade_id uuid not null references public.unidades(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ─── Catálogo de materiais ─────────────────────────────────────────
create table if not exists public.materiais (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  nome_canonico text,
  categoria text,
  unidade_medida text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists materiais_nome_uq on public.materiais (lower(nome));

-- ─── Pedidos / requisições de materiais ────────────────────────────
create table if not exists public.requisicoes (
  id uuid primary key default gen_random_uuid(),
  firestore_id text unique,
  unidade_id uuid references public.unidades(id),
  unidade_nome_snap text,
  status text not null default 'requisitado',
  tipos text[] default '{}',
  formato text,
  file_name text,
  period_label text,
  period_start date,
  period_end date,
  data_requisicao timestamptz,
  data_entrega timestamptz,
  responsavel text,
  separador text,
  entregue_por text,
  retirado_por text,
  observacao text,
  origem text,
  deleted boolean not null default false,
  registrado_em timestamptz not null default now(),
  raw jsonb
);
create index if not exists requisicoes_unidade_idx on public.requisicoes (unidade_id);
create index if not exists requisicoes_status_idx on public.requisicoes (status);
create index if not exists requisicoes_periodo_idx on public.requisicoes (period_start, period_end);
create index if not exists requisicoes_registrado_idx on public.requisicoes (registrado_em desc);

create table if not exists public.requisicao_itens (
  id uuid primary key default gen_random_uuid(),
  requisicao_id uuid not null references public.requisicoes(id) on delete cascade,
  material_id uuid references public.materiais(id),
  material_nome text not null,
  categoria text,
  qtd_solicitada numeric default 0,
  qtd_atendida numeric default 0,
  unidade_medida text,
  status text,
  observacao text
);
create index if not exists requisicao_itens_req_idx on public.requisicao_itens (requisicao_id);
create index if not exists requisicao_itens_material_idx on public.requisicao_itens (lower(material_nome));
create index if not exists requisicao_itens_categoria_idx on public.requisicao_itens (categoria);

-- ─── Histórico semanal (planilhas) ─────────────────────────────────
create table if not exists public.hist_semanas (
  id uuid primary key default gen_random_uuid(),
  firestore_id text unique,
  file_name text,
  week_start date,
  week_end date,
  week_label text,
  year int,
  month int,
  year_assumed boolean default false,
  raw jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.hist_semana_itens (
  id uuid primary key default gen_random_uuid(),
  hist_semana_id uuid not null references public.hist_semanas(id) on delete cascade,
  unidade_id uuid references public.unidades(id),
  unit_name text,
  raw_unit text,
  categoria text,
  material_nome text not null,
  qty numeric not null default 0
);
create index if not exists hist_itens_semana_idx on public.hist_semana_itens (hist_semana_id);
create index if not exists hist_itens_unidade_idx on public.hist_semana_itens (unidade_id);
create index if not exists hist_itens_material_idx on public.hist_semana_itens (lower(material_nome));

-- ─── Movimentações água / gás ──────────────────────────────────────
create table if not exists public.movimentacoes_agua (
  id uuid primary key default gen_random_uuid(),
  firestore_id text unique,
  unidade_id uuid references public.unidades(id),
  unidade_nome_snap text,
  tipo text not null check (tipo in ('entrega', 'retorno', 'retirada')),
  quantidade int not null default 0,
  data date,
  responsavel text,
  responsavel_almox text,
  observacao text,
  origem text,
  registrado_em timestamptz not null default now()
);
create index if not exists mov_agua_data_idx on public.movimentacoes_agua (data);
create index if not exists mov_agua_unidade_data_idx on public.movimentacoes_agua (unidade_id, data);

create table if not exists public.movimentacoes_gas (
  id uuid primary key default gen_random_uuid(),
  firestore_id text unique,
  unidade_id uuid references public.unidades(id),
  unidade_nome_snap text,
  tipo text not null check (tipo in ('entrega', 'retorno', 'retirada')),
  quantidade int not null default 0,
  data date,
  responsavel text,
  responsavel_almox text,
  observacao text,
  origem text,
  registrado_em timestamptz not null default now()
);
create index if not exists mov_gas_data_idx on public.movimentacoes_gas (data);
create index if not exists mov_gas_unidade_data_idx on public.movimentacoes_gas (unidade_id, data);

create table if not exists public.estoque_entradas_agua (
  id uuid primary key default gen_random_uuid(),
  firestore_id text unique,
  tipo text not null check (tipo in ('inicial', 'entrada')),
  quantidade int not null default 0,
  data date,
  responsavel text,
  nota_fiscal text,
  registrado_em timestamptz not null default now()
);

create table if not exists public.estoque_entradas_gas (
  id uuid primary key default gen_random_uuid(),
  firestore_id text unique,
  tipo text not null check (tipo in ('inicial', 'entrada')),
  quantidade int not null default 0,
  data date,
  responsavel text,
  nota_fiscal text,
  registrado_em timestamptz not null default now()
);

-- ─── Social (cesta / enxoval) ──────────────────────────────────────
create table if not exists public.mov_cesta (
  id uuid primary key default gen_random_uuid(),
  firestore_id text unique,
  tipo text,
  destinatario text,
  quantidade numeric,
  categoria text,
  custo numeric,
  status text,
  registrado_em timestamptz not null default now(),
  raw jsonb
);

create table if not exists public.estoque_cesta (
  id uuid primary key default gen_random_uuid(),
  firestore_id text unique,
  tipo text,
  quantidade numeric,
  categoria text,
  registrado_em timestamptz not null default now(),
  raw jsonb
);

create table if not exists public.mov_enxoval (
  id uuid primary key default gen_random_uuid(),
  firestore_id text unique,
  tipo text,
  destinatario text,
  quantidade numeric,
  categoria text,
  custo numeric,
  status text,
  registrado_em timestamptz not null default now(),
  raw jsonb
);

create table if not exists public.estoque_enxoval (
  id uuid primary key default gen_random_uuid(),
  firestore_id text unique,
  tipo text,
  quantidade numeric,
  categoria text,
  registrado_em timestamptz not null default now(),
  raw jsonb
);

-- ─── Auxiliares ────────────────────────────────────────────────────
create table if not exists public.feriados (
  date date primary key,
  name text,
  nature text,
  weekday text
);

create table if not exists public.aliases_config (
  key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.status_public (
  id int primary key default 1 check (id = 1),
  agua int not null default 0,
  gas int not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.status_public (id, agua, gas)
values (1, 0, 0)
on conflict (id) do nothing;

create table if not exists public.importacoes (
  id uuid primary key default gen_random_uuid(),
  file_name text,
  file_hash text,
  modulo text,
  status text not null default 'ok',
  erros jsonb default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- ─── Views de relatório (materiais) ────────────────────────────────
create or replace view public.vw_itens_entregues with (security_invoker = true) as
select
  ri.id,
  r.id as requisicao_id,
  coalesce(r.period_start, r.data_requisicao::date) as data_ref,
  r.period_label,
  r.status as status_pedido,
  u.id as unidade_id,
  coalesce(u.nome, r.unidade_nome_snap) as unidade_nome,
  u.tipo as unidade_tipo,
  ri.categoria,
  ri.material_nome,
  ri.qtd_solicitada,
  ri.qtd_atendida,
  ri.status as status_item
from public.requisicao_itens ri
join public.requisicoes r on r.id = ri.requisicao_id
left join public.unidades u on u.id = r.unidade_id
where coalesce(r.deleted, false) = false;

create or replace view public.vw_hist_itens with (security_invoker = true) as
select
  hsi.id,
  hs.week_start,
  hs.week_end,
  hs.week_label,
  hs.year,
  hs.month,
  hs.file_name,
  u.id as unidade_id,
  coalesce(u.nome, hsi.unit_name) as unidade_nome,
  u.tipo as unidade_tipo,
  hsi.categoria,
  hsi.material_nome,
  hsi.qty
from public.hist_semana_itens hsi
join public.hist_semanas hs on hs.id = hsi.hist_semana_id
left join public.unidades u on u.id = hsi.unidade_id;

-- Relatório pronto: item × unidade × período
create or replace function public.report_itens_por_unidade(
  p_from date,
  p_to date,
  p_unidade_id uuid default null,
  p_categoria text default null
)
returns table (
  unidade_nome text,
  unidade_tipo text,
  categoria text,
  material_nome text,
  qtd_total numeric,
  pedidos bigint
)
language sql
stable
as $$
  select
    v.unidade_nome,
    v.unidade_tipo,
    v.categoria,
    v.material_nome,
    sum(coalesce(nullif(v.qtd_atendida, 0), v.qtd_solicitada, 0)) as qtd_total,
    count(distinct v.requisicao_id) as pedidos
  from public.vw_itens_entregues v
  where v.data_ref between p_from and p_to
    and (p_unidade_id is null or v.unidade_id = p_unidade_id)
    and (p_categoria is null or v.categoria = p_categoria)
  group by 1, 2, 3, 4
  order by qtd_total desc, unidade_nome, material_nome;
$$;

-- ─── RLS básica ────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.unidades enable row level security;
alter table public.aliases_unidades enable row level security;
alter table public.materiais enable row level security;
alter table public.requisicoes enable row level security;
alter table public.requisicao_itens enable row level security;
alter table public.hist_semanas enable row level security;
alter table public.hist_semana_itens enable row level security;
alter table public.movimentacoes_agua enable row level security;
alter table public.movimentacoes_gas enable row level security;
alter table public.estoque_entradas_agua enable row level security;
alter table public.estoque_entradas_gas enable row level security;
alter table public.mov_cesta enable row level security;
alter table public.estoque_cesta enable row level security;
alter table public.mov_enxoval enable row level security;
alter table public.estoque_enxoval enable row level security;
alter table public.feriados enable row level security;
alter table public.aliases_config enable row level security;
alter table public.status_public enable row level security;
alter table public.importacoes enable row level security;

-- Papel do usuário logado (admin | editor | viewer). Visitante anônimo = viewer.
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'viewer');
$$;

-- Políticas recriadas do zero (Postgres não aceita "create policy if not exists")
do $$
declare
  t text;
  pol record;
  leitura text[] := array[
    'profiles','unidades','aliases_unidades','materiais','requisicoes','requisicao_itens',
    'hist_semanas','hist_semana_itens','movimentacoes_agua','movimentacoes_gas',
    'estoque_entradas_agua','estoque_entradas_gas','mov_cesta','estoque_cesta',
    'mov_enxoval','estoque_enxoval','feriados','aliases_config','status_public','importacoes'
  ];
  -- escrita só admin
  so_admin text[] := array['profiles','unidades','aliases_unidades','feriados','aliases_config'];
  -- escrita admin + editor
  equipe text[] := array[
    'materiais','requisicoes','requisicao_itens','hist_semanas','hist_semana_itens',
    'movimentacoes_agua','movimentacoes_gas','estoque_entradas_agua','estoque_entradas_gas',
    'mov_cesta','estoque_cesta','mov_enxoval','estoque_enxoval','status_public','importacoes'
  ];
begin
  foreach t in array leitura loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_leitura', t);
  end loop;

  foreach t in array so_admin loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.app_role() = ''admin'') with check (public.app_role() = ''admin'')',
      t || '_escrita_admin', t
    );
  end loop;

  foreach t in array equipe loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.app_role() in (''admin'', ''editor'')) with check (public.app_role() in (''admin'', ''editor''))',
      t || '_escrita_equipe', t
    );
  end loop;
end $$;
