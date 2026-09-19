-- One row per tick. tick_no is the right key for a single run's ordering, but
-- NOT a cross-run clock: the ~1 Hz cadence is not uniform, and 17 of 284
-- scenarios spread >= 2 s at a common tick index. Pool runs on elapsed time.
create view tick as
select s.run_id, (x.ord - 1)::smallint as tick_no,
       x.t, x.shots_fired, x.shots_hit, x.shots_missed, x.damage_done,
       x.damage_possible, x.score, x.kills, x.overshots,
       x.player_damage_taken, x.reloads, x.pause_count,
       x.distance_traveled, x.mbs_points
from run_series s,
     unnest(s.t, s.shots_fired, s.shots_hit, s.shots_missed, s.damage_done,
            s.damage_possible, s.score, s.kills, s.overshots,
            s.player_damage_taken, s.reloads, s.pause_count,
            s.distance_traveled, s.mbs_points)
     with ordinality as x(t, shots_fired, shots_hit, shots_missed, damage_done,
                          damage_possible, score, kills, overshots,
                          player_damage_taken, reloads, pause_count,
                          distance_traveled, mbs_points, ord);

-- One row per kill. t_offset is null for a reset, where offsets against
-- Challenge Start are meaningless; inter-kill deltas from at_ms are not.
create view kill as
select k.run_id, (x.ord - 1)::smallint as ordinal, x.at_ms, x.bot_id, x.weapon_id,
       x.ttk, x.shots, x.hits, x.damage_done, x.damage_possible, x.overshots,
       x.cheated <> 0 as cheated,
       x.hits::real / nullif(x.shots, 0) as accuracy,
       x.damage_done / nullif(x.damage_possible, 0) as efficiency,
       -- A plain difference, deliberately not wrapped modulo a day: a negative
       -- value means either a midnight rollover or clock skew, and both should
       -- be visible rather than silently rendered as ~86399.99. Two integers on
       -- the same clock, so it does not depend on the session TimeZone.
       case when r.start_ms is not null
            then ((x.at_ms - r.start_ms) / 1000.0)::real
       end as t_offset
from kill_series k
join run r on r.id = k.run_id,
     unnest(k.at_ms, k.bot_id, k.weapon_id, k.ttk, k.shots, k.hits,
            k.damage_done, k.damage_possible, k.overshots, k.cheated)
     with ordinality as x(at_ms, bot_id, weapon_id, ttk, shots, hits,
                          damage_done, damage_possible, overshots, cheated, ord);

-- Complete runs with their dimensions resolved. The baseline for analysis:
-- partials are excluded here rather than in every downstream query.
create view run_complete as
select r.*, s.hash as scenario_hash, s.name as scenario_name, g.label as game_version,
       p.run_id is not null as has_perf
from run r
join scenario s on s.id = r.scenario_id
join game_version g on g.id = r.game_version_id
left join run_perf p on p.run_id = r.id
where r.kind = 'complete';

-- Attempt numbering over ALL runs of a scenario, resets included. run_progress
-- cannot answer this: it is defined over completions, so its completion_no is
-- n-th completion, while "a PB set on the 16th attempt" counts rerolls.
--
-- WINDOW VIEW: always filter this on scenario_id, its partition key. A filter
-- on anything else is applied only after the window has run over every row.
create view run_attempt as
select id, scenario_id, kind, written_at,
       row_number() over w as attempt_no,
       count(*) filter (where kind = 'reset')
         over (partition by scenario_id order by written_at
               rows between unbounded preceding and 1 preceding) as resets_before
from run
window w as (partition by scenario_id order by written_at);

-- Per-run position in its scenario's history.
--
-- WINDOW VIEW: always filter this on scenario_id, its partition key. Measured
-- on 100k rows: filtered by scenario_id, 334 rows touched in 5.2 ms; filtered
-- by score, all 100,000. To filter on anything else, filter inside a CTE first
-- and apply the window after.
create view run_progress as
select r.*,
       row_number() over w                                        as completion_no,
       lag(r.score)  over w                                             as prev_score,
       max(r.score)  over (partition by r.scenario_id order by r.started_at
                           rows between unbounded preceding and 1 preceding) as pb_before,
       max(r.score)  over w                                             as best_so_far,
       lag(r.config_id) over w is not null
         and lag(r.config_id) over w <> r.config_id                     as config_changed
from run_complete r
window w as (partition by r.scenario_id order by r.started_at);

-- Sessions: a gap of more than 30 minutes starts a new one. Includes partials,
-- because reroll behaviour is part of what a session is. Three levels, because
-- a window function may not be nested inside another window's PARTITION BY.
create view run_session as
select id, scenario_id, kind, written_at, session_id,
       row_number() over (partition by session_id order by written_at, id)
         as position_in_session
from (
  select id, scenario_id, kind, written_at,
         sum(is_new) over (order by written_at, id) as session_id
  from (
    select id, scenario_id, kind, written_at,
           case when written_at - lag(written_at) over (order by written_at, id)
                     > interval '30 minutes'
                 or lag(written_at) over (order by written_at, id) is null
                then 1 else 0 end as is_new
    from run
  ) flagged
) segmented;
