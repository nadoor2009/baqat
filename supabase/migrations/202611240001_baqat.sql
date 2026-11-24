begin;

create table public.baqat_merchants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  approved boolean not null default false
);

create table public.baqat_offers (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.baqat_merchants(user_id),
  name text not null check (char_length(trim(name)) between 2 and 120),
  venue text not null check (char_length(trim(venue)) between 2 and 120),
  district text not null check (char_length(trim(district)) between 2 and 80),
  north boolean not null default false,
  address text not null check (char_length(trim(address)) between 3 and 240),
  latitude double precision not null check (latitude between 24.35 and 25.10),
  longitude double precision not null check (longitude between 46.30 and 47.10),
  price_halalas integer not null check (price_halalas between 100 and 10000000),
  people integer not null check (people between 1 and 100),
  meal text not null check (meal in ('lunch', 'dinner', 'both')),
  inclusions text not null check (char_length(trim(inclusions)) between 3 and 1800),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  published boolean not null default false,
  check (isfinite(starts_at) and isfinite(ends_at))
);

create table public.baqat_codes (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  customer_id uuid not null references auth.users(id),
  offer_id uuid not null references public.baqat_offers(id),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  redeemed_at timestamptz
);
create index baqat_codes_customer_issued_idx on public.baqat_codes(customer_id, issued_at desc);
create index baqat_offers_merchant_idx on public.baqat_offers(merchant_id);

alter table public.baqat_merchants enable row level security;
alter table public.baqat_offers enable row level security;
alter table public.baqat_codes enable row level security;
revoke all on public.baqat_merchants, public.baqat_offers, public.baqat_codes from public, anon, authenticated;
grant select on public.baqat_merchants to authenticated;
grant insert (user_id, name) on public.baqat_merchants to authenticated;
grant select on public.baqat_offers to anon, authenticated;
grant insert (merchant_id, name, venue, district, north, address, latitude, longitude, price_halalas, people, meal, inclusions, starts_at, ends_at) on public.baqat_offers to authenticated;
grant update (published) on public.baqat_offers to authenticated;

create policy merchant_reads_own on public.baqat_merchants
  for select to authenticated using (user_id = (select auth.uid()));
create policy merchant_applies on public.baqat_merchants
  for insert to authenticated with check (user_id = (select auth.uid()) and not approved);

-- Check merchant approval without exposing merchant applications to visitors.
create function public.baqat_is_approved(owner_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.baqat_merchants where user_id = owner_id and approved
  );
$$;
revoke all on function public.baqat_is_approved(uuid) from public, anon, authenticated;
grant execute on function public.baqat_is_approved(uuid) to anon, authenticated;

create policy published_offers on public.baqat_offers for select to anon, authenticated
  using (published and ends_at > now() and public.baqat_is_approved(merchant_id));
create policy merchant_reads_offers on public.baqat_offers for select to authenticated
  using (merchant_id = (select auth.uid()));
create policy merchant_creates_draft on public.baqat_offers for insert to authenticated
  with check (merchant_id = (select auth.uid()) and not published and public.baqat_is_approved(merchant_id));
create policy merchant_changes_publication on public.baqat_offers for update to authenticated
  using (merchant_id = (select auth.uid()) and public.baqat_is_approved(merchant_id))
  with check (merchant_id = (select auth.uid()) and public.baqat_is_approved(merchant_id));

create function public.baqat_issue(offer uuid)
returns table (code uuid, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  raw_code uuid := gen_random_uuid();
  issue_time timestamptz;
  expires timestamptz;
  end_time timestamptz;
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 418));
  issue_time := clock_timestamp();
  select o.ends_at into end_time
    from public.baqat_offers o join public.baqat_merchants m on m.user_id = o.merchant_id
    where o.id = offer and o.published and m.approved
      and o.merchant_id <> actor and o.starts_at <= issue_time and o.ends_at > issue_time;
  if not found then raise exception 'OFFER_UNAVAILABLE'; end if;
  if (select count(*) from public.baqat_codes c
      where c.customer_id = actor and c.issued_at > issue_time - interval '1 hour') >= 10 then
    raise exception 'ISSUE_LIMIT';
  end if;
  if exists (select 1 from public.baqat_codes c where c.customer_id = actor
      and c.offer_id = offer and c.expires_at > issue_time and c.redeemed_at is null) then
    raise exception 'ACTIVE_CODE_EXISTS';
  end if;
  expires := least(end_time, issue_time + interval '30 minutes');
  insert into public.baqat_codes values
    (sha256(convert_to(raw_code::text, 'UTF8')), actor, offer, issue_time, expires, null);
  return query select raw_code, expires;
end;
$$;

create function public.baqat_redeem(code uuid)
returns table (offer_name text, redeemed_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'AUTH_REQUIRED'; end if;
  return query
    update public.baqat_codes c
      set redeemed_at = clock_timestamp()
      from public.baqat_offers o, public.baqat_merchants m
      where c.token_hash = sha256(convert_to(code::text, 'UTF8'))
        and c.redeemed_at is null and c.expires_at > clock_timestamp()
        and o.id = c.offer_id and o.published
        and m.user_id = o.merchant_id and m.user_id = actor and m.approved
      returning o.name, c.redeemed_at;
end;
$$;
revoke all on function public.baqat_issue(uuid), public.baqat_redeem(uuid) from public, anon, authenticated;
grant execute on function public.baqat_issue(uuid), public.baqat_redeem(uuid) to authenticated;
commit;
