-- Camada de compatibilidade Firestore → Supabase (rodar depois do 001 e 003).
-- O app continua usando a API do Firestore; js/compat/* traduz para esta tabela.
-- Cada linha é um documento: col = caminho da coleção (ex.: artifacts/default-app-id/public/data/controleAgua).
-- Valores especiais em data: {"__ts": "ISO"} = Timestamp. Em escrita: {"__op": "inc"|"del"|"now"|"union"|"remove"|"put"}.

create table if not exists public.fs_docs (
  col text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
create index if not exists fs_docs_updated_idx on public.fs_docs (col, updated_at desc);

alter table public.fs_docs enable row level security;
alter table public.fs_docs replica identity full;

-- Nome curto da coleção (último segmento do caminho)
create or replace function public.fs_col_name(p_col text)
returns text language sql immutable as $$
  select regexp_replace(p_col, '^.*/', '');
$$;

-- Quem pode gravar em cada coleção (espelha o firestore.rules)
create or replace function public.fs_can_write(p_col text)
returns boolean language sql stable as $$
  select case
    when public.fs_col_name(p_col) = 'chat' then auth.uid() is not null
    when public.fs_col_name(p_col) in ('userRoles', 'unidades', 'feriados', 'semcasAliases') then public.app_role() = 'admin'
    else public.app_role() in ('admin', 'editor')
  end;
$$;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'fs_docs' loop
    execute format('drop policy %I on public.fs_docs', pol.policyname);
  end loop;
end $$;

create policy fs_docs_leitura on public.fs_docs for select to authenticated using (true);
create policy fs_docs_insere on public.fs_docs for insert to authenticated with check (public.fs_can_write(col));
create policy fs_docs_altera on public.fs_docs for update to authenticated using (public.fs_can_write(col)) with check (public.fs_can_write(col));
create policy fs_docs_apaga on public.fs_docs for delete to authenticated using (public.fs_can_write(col));

-- Aplica um "patch" no estilo Firestore (merge profundo + operações especiais)
create or replace function public.fs_apply(base jsonb, patch jsonb)
returns jsonb language plpgsql immutable as $$
declare
  k text;
  v jsonb;
  r jsonb := case when jsonb_typeof(base) = 'object' then base else '{}'::jsonb end;
  atual jsonb;
begin
  if patch is null or jsonb_typeof(patch) <> 'object' then
    return r;
  end if;
  for k, v in select * from jsonb_each(patch) loop
    atual := r -> k;
    if jsonb_typeof(v) = 'object' and v ? '__op' then
      case v ->> '__op'
        when 'del' then
          r := r - k;
        when 'inc' then
          r := r || jsonb_build_object(k, to_jsonb(
            (case when jsonb_typeof(atual) = 'number' then (atual #>> '{}')::numeric else 0 end) + (v ->> 'v')::numeric));
        when 'now' then
          r := r || jsonb_build_object(k, jsonb_build_object('__ts',
            to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
        when 'union' then
          r := r || jsonb_build_object(k,
            (case when jsonb_typeof(atual) = 'array' then atual else '[]'::jsonb end) ||
            coalesce((select jsonb_agg(e) from jsonb_array_elements(v -> 'v') e
                      where not ((case when jsonb_typeof(atual) = 'array' then atual else '[]'::jsonb end) @> jsonb_build_array(e))), '[]'::jsonb));
        when 'remove' then
          r := r || jsonb_build_object(k,
            coalesce((select jsonb_agg(e) from jsonb_array_elements(case when jsonb_typeof(atual) = 'array' then atual else '[]'::jsonb end) e
                      where not ((v -> 'v') @> jsonb_build_array(e))), '[]'::jsonb));
        when 'put' then
          r := r || jsonb_build_object(k,
            case when jsonb_typeof(v -> 'v') = 'object' and not ((v -> 'v') ? '__ts')
                 then public.fs_apply('{}'::jsonb, v -> 'v') else v -> 'v' end);
        else
          r := r || jsonb_build_object(k, v);
      end case;
    elsif jsonb_typeof(v) = 'object' and not (v ? '__ts') then
      r := r || jsonb_build_object(k, public.fs_apply(
        case when jsonb_typeof(atual) = 'object' and not (atual ? '__ts') then atual else '{}'::jsonb end, v));
    else
      r := r || jsonb_build_object(k, v);
    end if;
  end loop;
  return r;
end $$;

-- Escrita de um documento. p_mode: 'set' (substitui), 'merge' (setDoc merge), 'update' (exige existir)
create or replace function public.fs_write(p_col text, p_id text, p_data jsonb, p_mode text default 'set')
returns jsonb language plpgsql as $$
declare
  atual jsonb;
  novo jsonb;
begin
  select data into atual from public.fs_docs where col = p_col and id = p_id for update;
  if p_mode = 'update' and atual is null then
    raise exception 'not-found: %/%', p_col, p_id using errcode = 'P0002';
  end if;
  if p_mode = 'set' then
    novo := public.fs_apply('{}'::jsonb, p_data);
  else
    novo := public.fs_apply(coalesce(atual, '{}'::jsonb), p_data);
  end if;
  insert into public.fs_docs (col, id, data, updated_at)
  values (p_col, p_id, novo, now())
  on conflict (col, id) do update set data = excluded.data, updated_at = now();
  return novo;
end $$;

-- Várias escritas atômicas (writeBatch / runTransaction).
-- p_ops: [{"op":"set"|"merge"|"update"|"delete","col":..,"id":..,"data":{..}}]
create or replace function public.fs_batch(p_ops jsonb)
returns void language plpgsql as $$
declare
  o jsonb;
begin
  for o in select * from jsonb_array_elements(p_ops) loop
    if o ->> 'op' = 'delete' then
      delete from public.fs_docs where col = o ->> 'col' and id = o ->> 'id';
    else
      perform public.fs_write(o ->> 'col', o ->> 'id', o -> 'data', o ->> 'op');
    end if;
  end loop;
end $$;

-- Consulta no estilo Firestore.
-- p_filters: [["campo.sub", "==", valor], ...]  ops: == != < <= > >= in not-in array-contains array-contains-any
-- p_order: campo (ou '__name__' para o id); documentos sem o campo ficam de fora, como no Firestore.
-- p_after: [valor, id] do último documento da página anterior (startAfter).
create or replace function public.fs_query(
  p_col text,
  p_filters jsonb default '[]'::jsonb,
  p_order text default null,
  p_desc boolean default false,
  p_limit int default null,
  p_after jsonb default null
)
returns setof public.fs_docs language plpgsql stable as $$
declare
  q text := 'select * from public.fs_docs where col = ' || quote_literal(p_col);
  f jsonb;
  campo text;
  op text;
  val jsonb;
  sqlop text;
  ordem text;
begin
  for f in select * from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) loop
    campo := format('(data #> %L)', '{' || replace(f ->> 0, '.', ',') || '}');
    op := f ->> 1;
    val := f -> 2;
    if f ->> 0 = '__name__' then
      campo := 'to_jsonb(id)';
    end if;
    sqlop := case op when '==' then '=' when '!=' then '<>' when '<' then '<' when '<=' then '<='
                     when '>' then '>' when '>=' then '>=' else null end;
    if sqlop is not null then
      q := q || format(' and %s %s %L::jsonb', campo, sqlop, val::text);
    elsif op = 'in' then
      q := q || format(' and %L::jsonb @> jsonb_build_array(%s)', val::text, campo);
    elsif op = 'not-in' then
      q := q || format(' and not (%L::jsonb @> jsonb_build_array(%s))', val::text, campo);
    elsif op = 'array-contains' then
      q := q || format(' and %s @> jsonb_build_array(%L::jsonb)', campo, val::text);
    elsif op = 'array-contains-any' then
      q := q || format(' and exists (select 1 from jsonb_array_elements(%L::jsonb) x where %s @> jsonb_build_array(x))', val::text, campo);
    else
      raise exception 'operador não suportado: %', op;
    end if;
  end loop;

  if p_order is not null and p_order <> '__name__' then
    ordem := format('(data #> %L)', '{' || replace(p_order, '.', ',') || '}');
    q := q || format(' and %s is not null', ordem);
    if p_after is not null then
      q := q || format(' and (%s, id) %s (%L::jsonb, %L)', ordem, case when p_desc then '<' else '>' end,
                       (p_after -> 0)::text, p_after ->> 1);
    end if;
    q := q || format(' order by %s %s, id %s', ordem, case when p_desc then 'desc' else 'asc' end,
                     case when p_desc then 'desc' else 'asc' end);
  else
    if p_after is not null then
      q := q || format(' and id %s %L', case when p_desc then '<' else '>' end, p_after ->> 1);
    end if;
    q := q || format(' order by id %s', case when p_desc then 'desc' else 'asc' end);
  end if;

  if p_limit is not null then
    q := q || ' limit ' || p_limit::int;
  end if;
  return query execute q;
end $$;

-- Tempo real (onSnapshot)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fs_docs'
  ) then
    execute 'alter publication supabase_realtime add table public.fs_docs';
  end if;
exception when undefined_object then
  null; -- publicação não existe (ambiente local de teste)
end $$;
