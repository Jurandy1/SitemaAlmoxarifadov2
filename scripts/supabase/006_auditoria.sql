-- Auditoria de exclusões (rodar no SQL Editor do Supabase, depois do 004_fs_docs.sql).
--
-- Toda vez que um documento some de public.fs_docs (requisição, entrega, movimentação de água/gás,
-- planilha do histórico, etc.) o banco grava aqui: quem excluiu, quando, IP, navegador, computador
-- e uma cópia completa do que foi apagado (dá para recuperar).
-- Também registra a "exclusão suave" (quando o app só marca deleted = true).
--
-- O registro é feito pelo próprio banco (gatilho), então vale para qualquer tela ou script que exclua.
-- Ninguém pelo app consegue alterar ou apagar a auditoria; só o admin consegue ler.

create table if not exists public.auditoria (
  id bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  acao text not null,                 -- 'exclusao' | 'exclusao_suave'
  colecao text not null,              -- nome curto (ex.: controleMateriais)
  colecao_caminho text not null,      -- caminho completo em fs_docs.col
  doc_id text not null,
  resumo text,                        -- ex.: "Pedido 123 — CRAS Anil"
  usuario_id uuid,
  usuario_email text,
  usuario_papel text,
  ip text,
  ip_cadeia text,                     -- x-forwarded-for completo (proxies)
  navegador text,                     -- user-agent
  dispositivo_id text,                -- identificador fixo do navegador/computador (gerado pelo app)
  dispositivo_nome text,              -- nome dado ao computador na tela de Auditoria
  dados jsonb                         -- cópia do documento antes de ser apagado
);
create index if not exists auditoria_quando_idx on public.auditoria (quando desc);
create index if not exists auditoria_colecao_idx on public.auditoria (colecao, quando desc);
create index if not exists auditoria_usuario_idx on public.auditoria (usuario_email, quando desc);

alter table public.auditoria enable row level security;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'auditoria' loop
    execute format('drop policy %I on public.auditoria', pol.policyname);
  end loop;
end $$;

-- Só admin lê. Não existe política de insert/update/delete: pelo app ninguém mexe nos registros.
create policy auditoria_leitura_admin on public.auditoria
  for select to authenticated using (public.app_role() = 'admin');

revoke insert, update, delete, truncate on public.auditoria from anon, authenticated;

-- Lê um cabeçalho da requisição HTTP atual (PostgREST). Fora de uma requisição devolve null.
create or replace function public.audit_header(nome text)
returns text language plpgsql stable as $$
declare
  h json;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return null;
  end;
  return nullif(trim(h ->> lower(nome)), '');
end $$;

-- Texto curto para identificar o documento na lista
create or replace function public.audit_resumo(p_col text, d jsonb)
returns text language sql immutable as $$
  select nullif(concat_ws(' — ',
    case
      when public.fs_col_name(p_col) = 'controleMateriais' then 'Pedido ' || coalesce(d ->> 'id', d ->> 'numero', '?')
      else null
    end,
    coalesce(d ->> 'unidade', d ->> 'unidadeNome', d ->> 'unitName', d ->> 'nome'),
    nullif(d ->> 'status', '')
  ), '');
$$;

create or replace function public.fs_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acao text;
  v_dados jsonb;
  v_xff text;
  v_ip text;
  v_uid uuid;
begin
  if tg_op = 'DELETE' then
    v_acao := 'exclusao';
    v_dados := old.data;
  elsif tg_op = 'UPDATE' then
    v_acao := 'exclusao_suave';
    v_dados := old.data;
  else
    return null;
  end if;

  -- Chat não interessa para auditoria
  if public.fs_col_name(old.col) = 'chat' then
    return null;
  end if;

  v_xff := public.audit_header('x-forwarded-for');
  v_ip := coalesce(
    public.audit_header('cf-connecting-ip'),
    public.audit_header('x-real-ip'),
    nullif(trim(split_part(coalesce(v_xff, ''), ',', 1)), '')
  );

  begin
    v_uid := auth.uid();
  exception when others then
    v_uid := null;
  end;

  insert into public.auditoria (
    acao, colecao, colecao_caminho, doc_id, resumo,
    usuario_id, usuario_email, usuario_papel,
    ip, ip_cadeia, navegador, dispositivo_id, dispositivo_nome, dados
  ) values (
    v_acao, public.fs_col_name(old.col), old.col, old.id, public.audit_resumo(old.col, v_dados),
    v_uid,
    coalesce(auth.jwt() ->> 'email', (select email from auth.users where id = v_uid)),
    case when v_uid is null then coalesce(auth.role(), current_user) else public.app_role() end,
    v_ip, v_xff,
    public.audit_header('user-agent'),
    left(public.audit_header('x-dispositivo-id'), 80),
    left(public.audit_header('x-dispositivo-nome'), 120),
    v_dados
  );
  return null;
end $$;

drop trigger if exists fs_docs_auditoria on public.fs_docs;
drop trigger if exists fs_docs_auditoria_suave on public.fs_docs;
create trigger fs_docs_auditoria
  after delete on public.fs_docs
  for each row execute function public.fs_audit();
create trigger fs_docs_auditoria_suave
  after update on public.fs_docs
  for each row
  when ((new.data -> 'deleted') = 'true'::jsonb and (old.data -> 'deleted') is distinct from 'true'::jsonb)
  execute function public.fs_audit();
