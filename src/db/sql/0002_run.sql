-- One row per Stats.csv, keyed by filename stem: .perf is a subset of .csv, so
-- the CSV is the row and the perf is an attachment. file_stem is unique on disk
-- by construction and never rewritten, which makes re-ingesting a file a no-op
-- rather than a duplicate. (Hash, shots, hits) collides 75 times in 2468 files.
create table run (
  id              integer generated always as identity primary key,
  file_stem       text not null unique,

  scenario_id     integer  not null references scenario,
  config_id       integer  not null references config,
  game_version_id smallint not null references game_version,

  kind        run_kind    not null,
  started_at  timestamptz,           -- Challenge Start; null unless complete
  start_ms    integer,               -- same instant as ms since local midnight
  written_at  timestamptz not null,  -- filename timestamp, end of second
  duration_s  real,                  -- null unless complete

  span tstzrange generated always as (
    case when kind = 'complete' then tstzrange(started_at, written_at, '[)') end
  ) stored,

  -- Run totals, from the CSV's own key/value block (never recomputed from the
  -- series). shots and damage_possible are the sum of the weapon table.
  score             real,
  kills             integer,
  hit_count         integer not null,
  miss_count        integer not null,
  shots             integer not null,
  damage_done       real,
  damage_possible   real,
  damage_taken      real,
  total_overshots   integer,
  reloads           integer,
  distance_traveled double precision,
  mbs_points        real,
  fight_time_s      real,
  time_remaining_s  real,
  avg_ttk_s         real,
  pause_count       integer,
  pause_duration    real,
  avg_fps           real,             -- null for a reset: uninitialised there

  accuracy   real generated always as (hit_count::real / nullif(shots, 0)) virtual,
  efficiency real generated always as (damage_done / nullif(damage_possible, 0)) virtual,

  extra jsonb not null default '{}',

  constraint complete_has_start
    check ((kind = 'complete') = (started_at is not null)),
  constraint complete_has_start_ms
    check ((kind = 'complete') = (start_ms is not null)),
  constraint complete_has_duration
    check ((kind = 'complete') = (duration_s is not null)),
  -- Rejects the empty range (started_at = written_at, which would escape the
  -- exclusion constraint entirely) and turns a midnight-rollover mistake into a
  -- named constraint violation instead of an opaque range error.
  constraint complete_ends_after_start
    check (kind <> 'complete' or written_at > started_at),
  -- Avg FPS in a reset is uninitialised memory, observed up to 8.9e9.
  constraint fps_only_when_complete
    check (kind = 'complete' or avg_fps is null),
  -- Holds in 2495/2495 measured CSVs; a KovaaK's change to any of the three
  -- should fail at ingest rather than quietly skew accuracy.
  constraint shots_balance
    check (shots = hit_count + miss_count),
  -- "A player cannot be inside two completed runs at once" — the precondition
  -- the CSV<->perf join rests on, checked on every insert instead of assumed.
  -- The GiST index behind it also serves that join, but only through overlap
  -- against a one-second probe range, never plain containment: the perf's
  -- challenge_start_utc is truncated to the second and so is almost always
  -- earlier than started_at (measured: >= in 4 of 2156 pairs).
  constraint no_overlapping_runs
    exclude using gist (span with &&) where (kind = 'complete'),
  -- Referenced by run_perf, so that a .perf can only attach to a complete run.
  constraint run_id_kind unique (id, kind)
);

create index run_scenario_time  on run (scenario_id, started_at) include (score)
                                where kind = 'complete';
create index run_scenario_score on run (scenario_id, score desc)
                                where kind = 'complete';
create index run_written        on run (written_at desc);
create index run_config         on run (config_id) where kind = 'complete';
-- Not partial: the reroll-rate and attempt-numbering queries span both kinds.
create index run_scenario_kind  on run (scenario_id, kind);

-- Abort files: empty Scenario and Hash, so no scenario identity and nothing to
-- join. payload is the whole parsed document, not just the key/value block: the
-- one abort in the corpus has an empty kill table but a real weapon row with
-- 1306 shots and 827 hits, which "nothing is silently dropped" has to cover.
create table unattributed_file (
  file_stem  text primary key,
  written_at timestamptz not null,
  payload    jsonb not null
);
