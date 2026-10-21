-- Mantém public.profiles (usado nas regras de acesso) igual à coleção userRoles do app.
-- A tela "Gestão de Usuários" grava em userRoles (fs_docs); este gatilho replica o papel em profiles.
-- Rodar depois do 004_fs_docs.sql.

create or replace function public.fs_sync_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  papel text;
begin
  if public.fs_col_name(coalesce(new.col, old.col)) <> 'userRoles' then
    return null;
  end if;

  if tg_op = 'DELETE' then
    begin
      uid := old.id::uuid;
    exception when others then
      return null;
    end;
    -- sem registro em userRoles o app trata como visitante
    update public.profiles set role = 'viewer', updated_at = now() where id = uid;
    return null;
  end if;

  begin
    uid := new.id::uuid;
  exception when others then
    return null; -- id que não é de usuário do Supabase (ex.: id antigo do Firebase)
  end;
  if not exists (select 1 from auth.users where id = uid) then
    return null;
  end if;

  papel := case new.data ->> 'role' when 'admin' then 'admin' when 'editor' then 'editor' else 'viewer' end;
  insert into public.profiles (id, email, role, updated_at)
  values (uid, new.data ->> 'email', papel, now())
  on conflict (id) do update
    set role = excluded.role,
        email = coalesce(excluded.email, public.profiles.email),
        updated_at = now();
  return null;
end $$;

drop trigger if exists fs_docs_sync_profile on public.fs_docs;
create trigger fs_docs_sync_profile
  after insert or update or delete on public.fs_docs
  for each row execute function public.fs_sync_profile();
