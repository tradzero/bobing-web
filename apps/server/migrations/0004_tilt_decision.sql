ALTER TABLE roll_attempts
  ADD COLUMN requires_tilt_decision boolean NOT NULL DEFAULT false;

CREATE INDEX roll_attempts_due_reveal_index
  ON roll_attempts (reveal_at)
  WHERE status = 'computed';
