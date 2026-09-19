-- Scratch space for one ingest chunk. The worker COPYs flat rows in here and
-- the batch script in src/lib/ingest/batch.sql does the set logic: interning
-- dimensions, inserting runs, joining perfs, building the array columns.
--
-- Natural keys rather than ids, because the worker has never seen the database.
-- Unlogged because every table is truncated at the end of the batch, so WAL for
-- them is pure cost.

create unlogged table stage_run (
  file_stem     text     not null,
  scenario_hash text     not null,
  scenario_name text     not null,
  version_label text     not null,
  kind          run_kind not null,
  started_at    timestamptz,
  start_ms      integer,
  written_at    timestamptz not null,
  duration_s    real,

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
  avg_fps           real,
  extra             jsonb not null,

  -- The config dimension, inline. Interned by the batch script.
  sens_scale       text             not null,
  sens_increment   double precision not null,
  horiz_sens       real             not null,
  vert_sens        real             not null,
  dpi              integer          not null,
  fov              real             not null,
  fov_scale        text             not null,
  hide_gun         boolean          not null,
  crosshair        text             not null,
  crosshair_scale  real             not null,
  crosshair_color  char(8)          not null,
  resolution       text             not null,
  resolution_scale real             not null,
  max_fps_config   real             not null,
  input_lag        real             not null
);

-- One row per kill. Aggregated into kill_series and rolled up into run_bot by
-- the same scan, which is what keeps the two from ever disagreeing.
create unlogged table stage_kill (
  file_stem       text     not null,
  idx             integer  not null,  -- array position, not the file's `Kill #`
  at_ms           integer  not null,
  bot_name        text     not null,
  weapon_name     text     not null,
  ttk             real     not null,
  shots           smallint not null,
  hits            smallint not null,
  damage_done     real     not null,
  damage_possible real     not null,
  overshots       smallint not null,
  cheated         smallint not null
);

create unlogged table stage_weapon (
  file_stem       text not null,
  weapon_name     text not null,
  shots           integer not null,
  hits            integer not null,
  damage_done     real not null,
  damage_possible real not null
);

-- The three run_perf array columns stage as jsonb: JSON.stringify is correct by
-- construction, and a hand-rolled Postgres array literal holding bot names is a
-- quoting bug waiting to happen.
create unlogged table stage_perf (
  perf_file_stem      text not null,
  scenario_hash       text not null,   -- cross-checked against the CSV
  schema_version      smallint not null,
  challenge_start_utc timestamptz not null,
  time_limit                 real,
  timescale                  real,
  map_name                   text,
  map_scale                  real,
  player_profile             text,
  player_team                smallint,
  player_max_lives           integer,
  end_challenge_after_kills  real,
  end_challenge_after_damage real,
  added_bots    jsonb not null,
  bot_max_lives jsonb,
  bot_teams     jsonb
);

create unlogged table stage_tick (
  perf_file_stem text not null,
  idx            integer not null,
  t              real not null,
  shots_fired         integer,
  shots_hit           integer,
  shots_missed        integer,
  damage_done         real,
  damage_possible     real,
  score               real,
  kills               integer,
  overshots           integer,
  player_damage_taken real,
  reloads             integer,
  pause_count         integer,
  distance_traveled   real,
  mbs_points          real
);

create unlogged table stage_unattributed (
  file_stem  text not null,
  written_at timestamptz not null,
  payload    jsonb not null
);
