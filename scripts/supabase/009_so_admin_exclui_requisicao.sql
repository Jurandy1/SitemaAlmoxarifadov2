-- Só admin pode excluir requisições de materiais (rodar no SQL Editor do Supabase, depois do 004).
--
-- Antes: o banco deixava editor apagar documentos de controleMateriais (a tela só escondia o botão).
-- Agora: se quem está logado não for admin, a exclusão é recusada com erro, tanto a exclusão real
-- quanto a "exclusão suave" (marcar deleted = true). Editor continua criando, separando e entregando.
-- Scripts e o SQL Editor (sem login do app) não são afetados.

create or replace function public.fs_bloqueia_exclusao_requisicao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.fs_col_name(old.col) <> 'controleMateriais' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Só vale para quem acessa pelo app (anon/authenticated); service_role e SQL Editor passam
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and public.app_role() <> 'admin' then
    raise exception 'permission-denied: apenas administradores podem excluir requisições'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists fs_docs_so_admin_exclui on public.fs_docs;
create trigger fs_docs_so_admin_exclui
  before delete on public.fs_docs
  for each row execute function public.fs_bloqueia_exclusao_requisicao();

drop trigger if exists fs_docs_so_admin_exclui_suave on public.fs_docs;
create trigger fs_docs_so_admin_exclui_suave
  before update on public.fs_docs
  for each row
  when ((new.data -> 'deleted') = 'true'::jsonb and (old.data -> 'deleted') is distinct from 'true'::jsonb)
  execute function public.fs_bloqueia_exclusao_requisicao();
