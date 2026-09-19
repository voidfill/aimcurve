-- One ingest chunk, staged rows to real tables.
--
-- NOT a migration: src/db/migrations.ts globs src/db/sql/*.sql and applies each
-- file exactly once, which is the opposite of what a per-chunk script needs.
-- This file is loaded with `?raw` and executed on every batch.
--
-- Every insert is `on conflict do nothing` without a target, so it absorbs a
-- re-ingest, a two-tab race, and a run that already has its perf, whichever
-- unique constraint catches it first.

-- 1. Dimensions ------------------------------------------------------------

insert into scenario (hash, name)
select distinct scenario_hash, scenario_name from stage_run
on conflict do nothing;

insert into game_version (label)
select distinct version_label from stage_run
on conflict do nothing;

insert into bot (name)
select distinct bot_name from stage_kill
on conflict do nothing;

insert into weapon (name)
select distinct weapon_name from stage_kill
union
select distinct weapon_name from stage_weapon
on conflict do nothing;

insert into config (sens_scale, sens_increment, horiz_sens, vert_sens, dpi, fov,
                    fov_scale, hide_gun, crosshair, crosshair_scale, crosshair_color,
                    resolution, resolution_scale, max_fps_config, input_lag)
select distinct sens_scale, sens_increment, horiz_sens, vert_sens, dpi, fov,
                fov_scale, hide_gun, crosshair, crosshair_scale, crosshair_color,
                resolution, resolution_scale, max_fps_config, input_lag
from stage_run
on conflict do nothing;

-- 2. The run spine ---------------------------------------------------------

insert into run (file_stem, scenario_id, config_id, game_version_id, kind,
                 started_at, start_ms, written_at, duration_s,
                 score, kills, hit_count, miss_count, shots, damage_done,
                 damage_possible, damage_taken, total_overshots, reloads,
                 distance_traveled, mbs_points, fight_time_s, time_remaining_s,
                 avg_ttk_s, pause_count, pause_duration, avg_fps, extra)
select s.file_stem, sc.id, cf.id, gv.id, s.kind,
       s.started_at, s.start_ms, s.written_at, s.duration_s,
       s.score, s.kills, s.hit_count, s.miss_count, s.shots, s.damage_done,
       s.damage_possible, s.damage_taken, s.total_overshots, s.reloads,
       s.distance_traveled, s.mbs_points, s.fight_time_s, s.time_remaining_s,
       s.avg_ttk_s, s.pause_count, s.pause_duration, s.avg_fps, s.extra
from stage_run s
join scenario     sc on sc.hash  = s.scenario_hash
join game_version gv on gv.label = s.version_label
join config       cf on (cf.sens_scale, cf.sens_increment, cf.horiz_sens, cf.vert_sens,
                         cf.dpi, cf.fov, cf.fov_scale, cf.hide_gun, cf.crosshair,
                         cf.crosshair_scale, cf.crosshair_color, cf.resolution,
                         cf.resolution_scale, cf.max_fps_config, cf.input_lag)
                      = (s.sens_scale, s.sens_increment, s.horiz_sens, s.vert_sens,
                         s.dpi, s.fov, s.fov_scale, s.hide_gun, s.crosshair,
                         s.crosshair_scale, s.crosshair_color, s.resolution,
                         s.resolution_scale, s.max_fps_config, s.input_lag)
on conflict do nothing;

insert into unattributed_file (file_stem, written_at, payload)
select file_stem, written_at, payload from stage_unattributed
on conflict do nothing;

-- 3. Per-run detail --------------------------------------------------------

insert into run_weapon (run_id, weapon_id, shots, hits, damage_done, damage_possible)
select r.id, w.id, sw.shots, sw.hits, sw.damage_done, sw.damage_possible
from stage_weapon sw
join run    r on r.file_stem = sw.file_stem
join weapon w on w.name      = sw.weapon_name
on conflict do nothing;

-- kill_series and run_bot come from the same resolved rows, in the same
-- transaction, which is what keeps the rollup from ever drifting from the
-- series it summarises. The `order by idx` is load-bearing: the alignment CHECK
-- catches a length mismatch but not a permutation.
insert into kill_series (run_id, at_ms, bot_id, weapon_id, ttk, shots, hits,
                         damage_done, damage_possible, overshots, cheated)
with staged_kills as (
  select r.id as run_id, k.idx, k.at_ms, b.id as bot_id, w.id as weapon_id, k.ttk,
         k.shots, k.hits, k.damage_done, k.damage_possible, k.overshots, k.cheated
  from stage_kill k
  join run    r on r.file_stem = k.file_stem
  join bot    b on b.name      = k.bot_name
  join weapon w on w.name      = k.weapon_name
)
select run_id,
       array_agg(at_ms           order by idx), array_agg(bot_id    order by idx),
       array_agg(weapon_id       order by idx), array_agg(ttk       order by idx),
       array_agg(shots           order by idx), array_agg(hits      order by idx),
       array_agg(damage_done     order by idx),
       array_agg(damage_possible order by idx),
       array_agg(overshots       order by idx), array_agg(cheated   order by idx)
from staged_kills group by run_id
on conflict do nothing;

insert into run_bot (run_id, bot_id, kills, avg_ttk, shots, hits,
                     damage_done, damage_possible, overshots)
with staged_kills as (
  select r.id as run_id, b.id as bot_id, k.ttk, k.shots, k.hits,
         k.damage_done, k.damage_possible, k.overshots
  from stage_kill k
  join run r on r.file_stem = k.file_stem
  join bot b on b.name      = k.bot_name
)
select run_id, bot_id, count(*), avg(ttk), sum(shots), sum(hits),
       sum(damage_done), sum(damage_possible), sum(overshots)
from staged_kills group by run_id, bot_id
on conflict do nothing;

-- 4. The perf join ---------------------------------------------------------
--
-- A .perf belongs to the unique complete CSV whose interval contains its
-- challenge_start_utc, with 1000 ms of lower-bound slack to absorb the format's
-- truncation. Written as an overlap against a one-second probe rather than as
-- containment, because the perf's start is truncated to the second and is
-- therefore almost always *earlier* than started_at (>= in 4 of 2156 pairs).
--
-- `kind = 'complete'` must be repeated: the index is partial and the planner
-- cannot prove `span is not null => kind = 'complete'` through a generated column.

insert into run_perf (run_id, perf_file_stem, challenge_start_utc, schema_version,
                      time_limit, timescale, map_name, map_scale, player_profile,
                      player_team, player_max_lives, end_challenge_after_kills,
                      end_challenge_after_damage, added_bots, bot_max_lives, bot_teams)
select r.id, p.perf_file_stem, p.challenge_start_utc, p.schema_version,
       p.time_limit, p.timescale, p.map_name, p.map_scale, p.player_profile,
       p.player_team, p.player_max_lives, p.end_challenge_after_kills,
       p.end_challenge_after_damage,
       array(select jsonb_array_elements_text(p.added_bots)),
       case when p.bot_max_lives is null then null
            else array(select jsonb_array_elements_text(p.bot_max_lives))::smallint[] end,
       case when p.bot_teams is null then null
            else array(select jsonb_array_elements_text(p.bot_teams))::smallint[] end
from stage_perf p
join run r on r.kind = 'complete'
          and r.span && tstzrange(p.challenge_start_utc,
                                  p.challenge_start_utc + interval '1 second')
on conflict do nothing;

-- 5. The tick series -------------------------------------------------------
--
-- A whole metric column is NULL when the run never reported that event, which
-- the vendor documents as "not applicable to this scenario" rather than zero.
-- `count(x) = 0` distinguishes that from a column of all-NULL ticks.

insert into run_series (run_id, t, shots_fired, shots_hit, shots_missed, damage_done,
                        damage_possible, score, kills, overshots, player_damage_taken,
                        reloads, pause_count, distance_traveled, mbs_points)
select rp.run_id,
       array_agg(st.t order by st.idx),
       case when count(st.shots_fired)         = 0 then null else array_agg(st.shots_fired         order by st.idx) end,
       case when count(st.shots_hit)           = 0 then null else array_agg(st.shots_hit           order by st.idx) end,
       case when count(st.shots_missed)        = 0 then null else array_agg(st.shots_missed        order by st.idx) end,
       case when count(st.damage_done)         = 0 then null else array_agg(st.damage_done         order by st.idx) end,
       case when count(st.damage_possible)     = 0 then null else array_agg(st.damage_possible     order by st.idx) end,
       case when count(st.score)               = 0 then null else array_agg(st.score               order by st.idx) end,
       case when count(st.kills)               = 0 then null else array_agg(st.kills               order by st.idx) end,
       case when count(st.overshots)           = 0 then null else array_agg(st.overshots           order by st.idx) end,
       case when count(st.player_damage_taken) = 0 then null else array_agg(st.player_damage_taken order by st.idx) end,
       case when count(st.reloads)             = 0 then null else array_agg(st.reloads             order by st.idx) end,
       case when count(st.pause_count)         = 0 then null else array_agg(st.pause_count         order by st.idx) end,
       case when count(st.distance_traveled)   = 0 then null else array_agg(st.distance_traveled   order by st.idx) end,
       case when count(st.mbs_points)          = 0 then null else array_agg(st.mbs_points          order by st.idx) end
from stage_tick st
join run_perf rp on rp.perf_file_stem = st.perf_file_stem
group by rp.run_id
on conflict do nothing;
