# Apply 2B-1 coastal admin1 fix

Paste the SQL below into the Supabase SQL editor after `20261008000002` is applied. Do **not** use `supabase db push`.

The same statement is stored at `supabase/migrations/20261008000003_crisis_coast_admin1.sql`.

Then:

```
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261008000003','20261008000003_crisis_coast_admin1') ON CONFLICT DO NOTHING;
```

```
npx tsx --env-file=.env.local scripts/crisis/verify-2b1.ts
```

Expect the Ruteng point (`-7.7761, 120.5395`) → `nearest_coast`, **level=1**, Indonesian admin1 (typically Nusa Tenggara Timur), and mid-ocean `(0, -150)` → `none`.

## Why

KNN over all `crisis_regions` preferred the country polygon (level 0): Indonesia’s hull is closer in bounding-box space than the nearest province. Nearest search now uses **admin1 only** (KNN 10, then exact geography distance, ≤ 300 km). Country is used only if no admin1 is within 300 km.

## SQL

```sql
-- Prefer nearest admin1 for coastal assignment. Country is fallback only.
--
-- DO NOT apply via supabase db push. Paste into the Supabase SQL Editor.
-- Rollback and the ledger insert are in docs/crisis/APPLY_2B1_FIX.md.

create or replace function public.crisis_assign_signal()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  assigned bigint;
  method text := 'none';
  dist_km double precision;
  pt extensions.geometry;
begin
  if new.lat is not null and new.lon is not null then
    new.geom := extensions.ST_SetSRID(extensions.ST_MakePoint(new.lon, new.lat), 4326);
  end if;

  if new.geom is not null and new.region_id is null then
    pt := new.geom;

    select r.id into assigned
    from public.crisis_regions r
    where r.level = 1
      and extensions.ST_Contains(r.geom, pt)
    order by extensions.ST_Area(r.geom) asc
    limit 1;

    if assigned is not null then
      method := 'contains';
      dist_km := 0;
    else
      select r.id into assigned
      from public.crisis_regions r
      where r.level = 0
        and extensions.ST_Contains(r.geom, pt)
      limit 1;

      if assigned is not null then
        method := 'contains';
        dist_km := 0;
      else
        select nearest.id, nearest.dist_m / 1000.0
          into assigned, dist_km
        from (
          select
            r.id,
            extensions.ST_Distance(
              r.geom::extensions.geography,
              pt::extensions.geography
            ) as dist_m
          from (
            select id, geom
            from public.crisis_regions
            where level = 1
            order by geom <-> pt
            limit 10
          ) r
        ) nearest
        where nearest.dist_m <= 300000
        order by nearest.dist_m asc
        limit 1;

        if assigned is not null then
          method := 'nearest_coast';
        else
          select nearest.id, nearest.dist_m / 1000.0
            into assigned, dist_km
          from (
            select
              r.id,
              extensions.ST_Distance(
                r.geom::extensions.geography,
                pt::extensions.geography
              ) as dist_m
            from (
              select id, geom
              from public.crisis_regions
              where level = 0
              order by geom <-> pt
              limit 10
            ) r
          ) nearest
          where nearest.dist_m <= 300000
          order by nearest.dist_m asc
          limit 1;

          if assigned is not null then
            method := 'nearest_coast';
          else
            dist_km := null;
          end if;
        end if;
      end if;
    end if;

    new.region_id := assigned;
    new.region_assign_method := method;
    new.region_distance_km := dist_km;
  else
    if new.region_assign_method is null then
      new.region_assign_method := case
        when new.region_id is not null then 'contains'
        else 'none'
      end;
    end if;
    if new.region_id is not null and new.region_distance_km is null
       and new.region_assign_method = 'contains' then
      new.region_distance_km := 0;
    end if;
  end if;

  if new.country_iso3 is null and new.region_id is not null then
    select r.iso3 into new.country_iso3
    from public.crisis_regions r
    where r.id = new.region_id;
  end if;

  if new.region_assign_method is null then
    new.region_assign_method := 'none';
  end if;

  return new;
end;
$$;
```

## Ledger insert

```sql
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20261008000003','20261008000003_crisis_coast_admin1') ON CONFLICT DO NOTHING;
```

## Rollback

Restores the `20261008000002` function body exactly. Does not drop tables or PostGIS.

```sql
create or replace function public.crisis_assign_signal()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  assigned bigint;
  method text := 'none';
  dist_km double precision;
  pt extensions.geometry;
begin
  if new.lat is not null and new.lon is not null then
    new.geom := extensions.ST_SetSRID(extensions.ST_MakePoint(new.lon, new.lat), 4326);
  end if;

  if new.geom is not null and new.region_id is null then
    pt := new.geom;

    select r.id into assigned
    from public.crisis_regions r
    where r.level = 1
      and extensions.ST_Contains(r.geom, pt)
    order by extensions.ST_Area(r.geom) asc
    limit 1;

    if assigned is not null then
      method := 'contains';
      dist_km := 0;
    else
      select r.id into assigned
      from public.crisis_regions r
      where r.level = 0
        and extensions.ST_Contains(r.geom, pt)
      limit 1;

      if assigned is not null then
        method := 'contains';
        dist_km := 0;
      else
        select nearest.id, nearest.dist_m / 1000.0
          into assigned, dist_km
        from (
          select
            r.id,
            extensions.ST_Distance(
              r.geom::extensions.geography,
              pt::extensions.geography
            ) as dist_m
          from (
            select id, geom
            from public.crisis_regions
            order by geom <-> pt
            limit 5
          ) r
        ) nearest
        where nearest.dist_m <= 300000
        order by nearest.dist_m asc
        limit 1;

        if assigned is not null then
          method := 'nearest_coast';
        else
          dist_km := null;
        end if;
      end if;
    end if;

    new.region_id := assigned;
    new.region_assign_method := method;
    new.region_distance_km := dist_km;
  else
    if new.region_assign_method is null then
      new.region_assign_method := case
        when new.region_id is not null then 'contains'
        else 'none'
      end;
    end if;
    if new.region_id is not null and new.region_distance_km is null
       and new.region_assign_method = 'contains' then
      new.region_distance_km := 0;
    end if;
  end if;

  if new.country_iso3 is null and new.region_id is not null then
    select r.iso3 into new.country_iso3
    from public.crisis_regions r
    where r.id = new.region_id;
  end if;

  if new.region_assign_method is null then
    new.region_assign_method := 'none';
  end if;

  return new;
end;
$$;

delete from supabase_migrations.schema_migrations
where version = '20261008000003';
```
