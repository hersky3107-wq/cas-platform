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
