-- Criação de usuários pela tela "Gestão de Usuários" (rodar no SQL Editor do Supabase, depois do 004 e 005).
--
-- Por que existe: o cadastro normal do Supabase (signUp) exige confirmar o e-mail. A conta criada
-- pelo admin ficava "não confirmada" e a pessoa não conseguia entrar. Esta função cria a conta
-- já confirmada, com a senha inicial definida pelo admin, e grava a permissão (userRoles → profiles).
-- Só quem é admin consegue chamar.
--
-- Se o e-mail já existe mas nunca foi confirmado (contas criadas antes desta correção),
-- a função confirma a conta e redefine a senha inicial em vez de dar erro.

create or replace function public.admin_criar_usuario(
  p_email text,
  p_senha text,
  p_papel text,
  p_roles_col text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_uid uuid;
  v_confirmado timestamptz;
  v_instance uuid;
  v_hash text;
begin
  if public.app_role() <> 'admin' then
    raise exception 'permission-denied: apenas administradores podem criar usuários' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid-email: e-mail inválido' using errcode = '22023';
  end if;
  if length(coalesce(p_senha, '')) < 6 then
    raise exception 'weak-password: a senha precisa de pelo menos 6 caracteres' using errcode = '22023';
  end if;
  if p_papel not in ('admin', 'editor', 'anon', 'viewer') then
    raise exception 'invalid-argument: permissão inválida' using errcode = '22023';
  end if;
  if public.fs_col_name(coalesce(p_roles_col, '')) <> 'userRoles' then
    raise exception 'invalid-argument: coleção de permissões inválida' using errcode = '22023';
  end if;

  v_hash := extensions.crypt(p_senha, extensions.gen_salt('bf'));

  select id, email_confirmed_at into v_uid, v_confirmado
  from auth.users where lower(email) = v_email limit 1;

  if v_uid is not null and v_confirmado is not null then
    raise exception 'email-already-in-use: este e-mail já está cadastrado' using errcode = '23505';
  end if;

  if v_uid is not null then
    -- Conta antiga que ficou presa sem confirmação: confirma e define a senha inicial
    update auth.users
       set encrypted_password = v_hash,
           email_confirmed_at = now(),
           raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"must_change_password": true}'::jsonb,
           confirmation_token = '',
           updated_at = now()
     where id = v_uid;
  else
    v_uid := gen_random_uuid();
    select instance_id into v_instance from auth.users where instance_id is not null limit 1;
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      coalesce(v_instance, '00000000-0000-0000-0000-000000000000'::uuid), v_uid, 'authenticated', 'authenticated',
      v_email, v_hash, now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"must_change_password": true}'::jsonb,
      now(), now(), '', '', '', ''
    );
  end if;

  if not exists (select 1 from auth.identities where user_id = v_uid and provider = 'email') then
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), v_uid::text, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end if;

  -- Permissão no app (o gatilho do 005 replica em public.profiles)
  perform public.fs_write(
    p_roles_col, v_uid::text,
    jsonb_build_object('uid', v_uid::text, 'email', v_email, 'role', p_papel, 'createdAt', jsonb_build_object('__op', 'now')),
    'set'
  );

  return v_uid;
end $$;

revoke all on function public.admin_criar_usuario(text, text, text, text) from public, anon;
grant execute on function public.admin_criar_usuario(text, text, text, text) to authenticated;
