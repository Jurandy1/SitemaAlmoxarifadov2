-- Quem pode ver a Auditoria (rodar no SQL Editor do Supabase, depois do 006_auditoria.sql).
--
-- Regra: admin vê a auditoria, EXCETO os usuários listados em public.auditoria_bloqueados.
-- O bloqueio vale no banco (não só esconde o menu): o usuário bloqueado não consegue ler a tabela.
-- Ninguém consegue mexer na lista pelo app; para mudar, edite aqui e rode de novo no SQL Editor.

create table if not exists public.auditoria_bloqueados (
  usuario_id uuid primary key,
  email text,
  motivo text,
  criado_em timestamptz not null default now()
);
alter table public.auditoria_bloqueados enable row level security;
revoke all on public.auditoria_bloqueados from anon, authenticated;

insert into public.auditoria_bloqueados (usuario_id, email, motivo)
values ('1c075c63-dbbe-48d2-bd4e-0cb0c1be1436', 'jujuba100054@gmail.com', 'Admin sem acesso à auditoria')
on conflict (usuario_id) do nothing;

create or replace function public.pode_ver_auditoria()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_role() = 'admin'
     and auth.uid() is not null
     and not exists (select 1 from public.auditoria_bloqueados where usuario_id = auth.uid());
$$;

revoke all on function public.pode_ver_auditoria() from public, anon;
grant execute on function public.pode_ver_auditoria() to authenticated;

drop policy if exists auditoria_leitura_admin on public.auditoria;
create policy auditoria_leitura_admin on public.auditoria
  for select to authenticated using (public.pode_ver_auditoria());
