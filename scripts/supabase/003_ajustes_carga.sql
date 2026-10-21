-- Ajustes para a carga completa do Firestore (rodar depois do 001_schema.sql).
-- Guarda o documento original em "raw" onde faltava, para não perder nenhum campo.

alter table public.unidades
  add column if not exists aliases text[] default '{}',
  add column if not exists raw jsonb;

alter table public.requisicoes
  add column if not exists tipo_unidade text,
  add column if not exists file_url text,
  add column if not exists storage_path text;

alter table public.requisicao_itens add column if not exists raw jsonb;

alter table public.hist_semanas add column if not exists updated_at timestamptz;

alter table public.hist_semana_itens
  add column if not exists qty_solicitada numeric,
  add column if not exists raw jsonb;

alter table public.movimentacoes_agua
  add column if not exists tipo_unidade text,
  add column if not exists raw jsonb;

alter table public.movimentacoes_gas
  add column if not exists tipo_unidade text,
  add column if not exists raw jsonb;

alter table public.estoque_entradas_agua add column if not exists raw jsonb;
alter table public.estoque_entradas_gas add column if not exists raw jsonb;
alter table public.feriados add column if not exists raw jsonb;

-- ─── Anexos dos pedidos (substitui o Firebase Storage) ─────────────
insert into storage.buckets (id, name, public)
values ('pedidos-materiais', 'pedidos-materiais', false)
on conflict (id) do nothing;

do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'pedidos_materiais_%'
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);
  end loop;
end $$;

create policy pedidos_materiais_leitura on storage.objects
  for select to authenticated
  using (bucket_id = 'pedidos-materiais');

create policy pedidos_materiais_escrita on storage.objects
  for all to authenticated
  using (bucket_id = 'pedidos-materiais' and public.app_role() in ('admin', 'editor'))
  with check (bucket_id = 'pedidos-materiais' and public.app_role() in ('admin', 'editor'));
