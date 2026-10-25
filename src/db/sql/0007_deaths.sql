-- reset: the .perf deaths event gets a column; the reingest also re-times runs from a clock-change day
--
-- `deaths` (field 9) was never observed until tf2_denial, where the player can
-- die: it raised at ingest, as an unknown event type is meant to. It is a
-- counter like kills, appended last so stage_tick's column order still matches
-- TICK_METRICS.
--
-- The reset is also what repairs runs from 2026-10-25: started_at was an hour
-- early there (see "A run straddling midnight" in docs/ingest.md), and ingest
-- skips files it already holds, so only a reingest corrects them.

alter table run_series add column deaths integer[];
alter table run_series add constraint run_series_deaths_aligned
  check (deaths is null or cardinality(deaths) = cardinality(t));

alter table stage_tick add column deaths integer;

create or replace view tick as
select s.run_id, (x.ord - 1)::smallint as tick_no,
       x.t, x.shots_fired, x.shots_hit, x.shots_missed, x.damage_done,
       x.damage_possible, x.score, x.kills, x.overshots,
       x.player_damage_taken, x.reloads, x.pause_count,
       x.distance_traveled, x.mbs_points, x.deaths
from run_series s,
     unnest(s.t, s.shots_fired, s.shots_hit, s.shots_missed, s.damage_done,
            s.damage_possible, s.score, s.kills, s.overshots,
            s.player_damage_taken, s.reloads, s.pause_count,
            s.distance_traveled, s.mbs_points, s.deaths)
     with ordinality as x(t, shots_fired, shots_hit, shots_missed, damage_done,
                          damage_possible, score, kills, overshots,
                          player_damage_taken, reloads, pause_count,
                          distance_traveled, mbs_points, deaths, ord);
