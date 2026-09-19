-- Batch-level "something was ingested". A statement-level trigger with a
-- transition table, so a 500-row COPY fires once rather than 500 times.
-- pg_notify caps at 8000 bytes, so the payload carries counts and ids, never
-- row contents: a listener that needs the rows queries for them.
create function notify_run_ingested() returns trigger language plpgsql as $$
begin
  perform pg_notify('run_ingested',
    json_build_object('count', (select count(*) from inserted),
                      'max_id', (select max(id) from inserted))::text);
  return null;
end $$;

create trigger run_ingested
after insert on run
referencing new table as inserted
for each statement execute function notify_run_ingested();
