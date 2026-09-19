create type run_kind as enum ('complete', 'reset');

-- Hash identifies the scenario at the exact version that produced the run;
-- grouping by name lets an edited scenario silently pollute a progress curve.
create table scenario (
  id    integer generated always as identity primary key,
  hash  char(32) not null unique,
  name  text     not null
);

create index scenario_name on scenario (name);

create table game_version (
  id    smallint generated always as identity primary key,
  label text not null unique
);

-- smallint ids: these two are referenced from inside arrays, where element
-- width is multiplied by 75k kill rows. Measured cardinality 124 and 18.
-- btrim checks: the corpus contains both " speedswitch " and "speedswitch",
-- alternating within one file, so an ingest that forgets to trim must fail
-- loudly rather than quietly fork a dimension.
create table bot (
  id   smallint generated always as identity primary key,
  name text not null unique,
  constraint bot_name_trimmed check (name = btrim(name) and name <> '')
);

create table weapon (
  id   smallint generated always as identity primary key,
  name text not null unique,
  constraint weapon_name_trimmed check (name = btrim(name) and name <> '')
);

-- The 15 client-configuration keys: 53 distinct combinations for 2495 runs.
-- The bound is one row per run (Random Sensitivity), which costs exactly what
-- inlining the columns would have cost, plus a 4-byte foreign key.
--
-- A natural UNIQUE rather than a hash fingerprint: a generated hash would need
-- real::text, whose immutability depends on a GUC, and at this cardinality the
-- wide index costs nothing.
create table config (
  id               integer generated always as identity primary key,
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
  input_lag        real             not null,
  unique (sens_scale, sens_increment, horiz_sens, vert_sens, dpi, fov, fov_scale,
          hide_gun, crosshair, crosshair_scale, crosshair_color, resolution,
          resolution_scale, max_fps_config, input_lag)
);
