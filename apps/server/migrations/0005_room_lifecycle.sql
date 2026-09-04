ALTER TABLE rooms
  ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN archived_at timestamptz;

ALTER TABLE games
  DROP CONSTRAINT games_status_check,
  ADD COLUMN abandoned_at timestamptz,
  ADD CONSTRAINT games_status_check
    CHECK (status IN ('lobby', 'playing', 'end-decision', 'bonus-round', 'finished', 'abandoned')),
  ADD CONSTRAINT games_abandoned_at_check
    CHECK (
      (status = 'abandoned' AND abandoned_at IS NOT NULL)
      OR (status <> 'abandoned' AND abandoned_at IS NULL)
    );

ALTER TABLE turns
  DROP CONSTRAINT turns_skip_reason_check,
  ADD CONSTRAINT turns_skip_reason_check
    CHECK (skip_reason IN ('turn-timeout', 'roll-error-limit', 'disconnected', 'room-abandoned'));

CREATE INDEX rooms_unarchived_activity_index
  ON rooms (last_activity_at)
  WHERE archived_at IS NULL;

CREATE INDEX rooms_archived_at_index
  ON rooms (archived_at)
  WHERE archived_at IS NOT NULL;
