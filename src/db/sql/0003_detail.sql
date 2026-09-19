-- Per-run sequences, stored as aligned parallel arrays and read through the
-- unnest views in 0004. Measured 3-5x smaller than row-per-record, 2x faster to
-- ingest, and the same query cost. Alignment is a CHECK, so a misaligned write
-- is rejected rather than silently producing skewed rows through unnest.
create table kill_series (
  run_id          integer primary key references run on delete cascade,
  at_ms           integer[]  not null,  -- ms since local midnight, verbatim
  bot_id          smallint[] not null,
  weapon_id       smallint[] not null,
  ttk             real[]     not null,
  shots           smallint[] not null,
  hits            smallint[] not null,
  damage_done     real[]     not null,
  damage_possible real[]     not null,
  overshots       smallint[] not null,
  cheated         smallint[] not null,  -- 1 of 75,504 rows is non-zero
  constraint kill_series_aligned check (
    cardinality(cheated)   = cardinality(at_ms) and
    cardinality(bot_id)    = cardinality(at_ms) and
    cardinality(weapon_id) = cardinality(at_ms) and
    cardinality(ttk)       = cardinality(at_ms) and
    cardinality(shots)     = cardinality(at_ms) and
    cardinality(hits)      = cardinality(at_ms) and
    cardinality(damage_done)     = cardinality(at_ms) and
    cardinality(damage_possible) = cardinality(at_ms) and
    cardinality(overshots) = cardinality(at_ms)
  )
);

create table run_weapon (
  run_id          integer  not null references run on delete cascade,
  weapon_id       smallint not null references weapon,
  shots           integer not null,
  hits            integer not null,
  damage_done     real    not null,
  damage_possible real    not null,
  primary key (run_id, weapon_id)
);

-- Per-run, per-bot rollup. A run never changes after it is written, so this is
-- immutable and is maintained at ingest rather than refreshed. It is also the
-- fastest path for the bot-breakdown use case: 2.4 ms, against 3.1 ms from kill
-- rows and 4.5 ms from kill arrays.
create table run_bot (
  run_id          integer  not null references run on delete cascade,
  bot_id          smallint not null references bot,
  kills           integer not null,
  avg_ttk         real    not null,
  shots           integer not null,
  hits            integer not null,
  damage_done     real    not null,
  damage_possible real    not null,
  overshots       integer not null,
  accuracy real generated always as (hits::real / nullif(shots, 0)) virtual,
  primary key (run_id, bot_id)
);

create index run_bot_bot on run_bot (bot_id);

create table run_perf (
  run_id              integer primary key references run on delete cascade,
  -- A .perf is only written on completion, so it can only attach to a complete
  -- run. Enforced with a composite FK, since a CHECK cannot span tables.
  kind                run_kind not null default 'complete' check (kind = 'complete'),
  -- The perf's own filename stem, which can differ from the CSV's: 8 pairs in
  -- the corpus are named a second apart. Without it, ingest has no dedup key
  -- for perfs and "0 perfs claimed twice" is not re-derivable from the database.
  perf_file_stem      text not null unique,
  schema_version      smallint not null,
  challenge_start_utc timestamptz not null,  -- truncated to the second by the format
  time_limit                real,
  timescale                 real,
  map_name                  text,
  map_scale                 real,
  player_profile            text,
  player_team               smallint,
  player_max_lives          integer,
  end_challenge_after_kills real,
  end_challenge_after_damage real,
  added_bots     text[]     not null,
  bot_max_lives  smallint[],
  bot_teams      smallint[],
  constraint bots_aligned check (
    (bot_max_lives is null or cardinality(bot_max_lives) = cardinality(added_bots)) and
    (bot_teams     is null or cardinality(bot_teams)     = cardinality(added_bots))
  ),
  foreign key (run_id, kind) references run (id, kind) on delete cascade
);

-- The 13 event types observed in the corpus, one array each, tick-aligned.
-- A type outside this set makes ingest raise; adding one is a migration.
--
-- A whole metric array is NULL when the run never emitted that event, which the
-- vendor documents as "not applicable to this scenario" rather than zero, and
-- inside a non-NULL array a tick where the metric did not change is NULL too.
create table run_series (
  run_id integer primary key references run on delete cascade,
  t                   real[] not null,   -- seconds since challenge start
  shots_fired         integer[],
  shots_hit           integer[],
  shots_missed        integer[],
  damage_done         real[],
  damage_possible     real[],
  score               real[],
  kills               integer[],
  overshots           integer[],         -- includes the terminal negative closer
  player_damage_taken real[],
  reloads             integer[],
  pause_count         integer[],
  distance_traveled   real[],
  mbs_points          real[],
  constraint run_series_aligned check (
    (shots_fired     is null or cardinality(shots_fired)     = cardinality(t)) and
    (shots_hit       is null or cardinality(shots_hit)       = cardinality(t)) and
    (shots_missed    is null or cardinality(shots_missed)    = cardinality(t)) and
    (damage_done     is null or cardinality(damage_done)     = cardinality(t)) and
    (damage_possible is null or cardinality(damage_possible) = cardinality(t)) and
    (score           is null or cardinality(score)           = cardinality(t)) and
    (kills           is null or cardinality(kills)           = cardinality(t)) and
    (overshots       is null or cardinality(overshots)       = cardinality(t)) and
    (player_damage_taken is null or cardinality(player_damage_taken) = cardinality(t)) and
    (reloads         is null or cardinality(reloads)         = cardinality(t)) and
    (pause_count     is null or cardinality(pause_count)     = cardinality(t)) and
    (distance_traveled is null or cardinality(distance_traveled) = cardinality(t)) and
    (mbs_points      is null or cardinality(mbs_points)      = cardinality(t))
  )
);
