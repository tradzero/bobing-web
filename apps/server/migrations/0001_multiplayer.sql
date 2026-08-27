CREATE TABLE rooms (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  access_type text NOT NULL DEFAULT 'open' CHECK (access_type IN ('open', 'password')),
  password_hash text,
  host_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (access_type = 'open' AND password_hash IS NULL)
    OR (access_type = 'password' AND password_hash IS NOT NULL)
  )
);

CREATE TABLE room_members (
  id uuid PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  resume_token_hash bytea NOT NULL UNIQUE,
  seat integer CHECK (seat IS NULL OR seat >= 0),
  member_role text NOT NULL DEFAULT 'player' CHECK (member_role IN ('player', 'spectator')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  UNIQUE (room_id, normalized_name)
);

CREATE UNIQUE INDEX room_members_unique_active_seat
  ON room_members (room_id, seat)
  WHERE seat IS NOT NULL AND retired_at IS NULL;

ALTER TABLE rooms
  ADD CONSTRAINT rooms_host_member_fk
  FOREIGN KEY (host_member_id) REFERENCES room_members(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE games (
  id uuid PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  host_player_id uuid NOT NULL REFERENCES room_members(id),
  status text NOT NULL DEFAULT 'lobby'
    CHECK (status IN ('lobby', 'playing', 'end-decision', 'bonus-round', 'finished')),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  next_turn_sequence integer NOT NULL DEFAULT 1 CHECK (next_turn_sequence >= 1),
  pool_completed_by_player_id uuid REFERENCES room_members(id),
  end_decision_deadline_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX games_one_active_per_room
  ON games (room_id)
  WHERE status IN ('lobby', 'playing', 'end-decision', 'bonus-round');

CREATE TABLE game_players (
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES room_members(id),
  display_name text NOT NULL,
  seat integer NOT NULL CHECK (seat >= 0),
  PRIMARY KEY (game_id, player_id),
  UNIQUE (game_id, seat)
);

CREATE TABLE game_prize_pools (
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('zhuangyuan', 'duitang', 'sanhong', 'sijin', 'erju', 'yixiu')),
  initial_count integer NOT NULL CHECK (initial_count >= 0),
  remaining_count integer NOT NULL CHECK (remaining_count >= 0 AND remaining_count <= initial_count),
  PRIMARY KEY (game_id, tier)
);

CREATE TABLE turns (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence >= 1),
  cycle_number integer NOT NULL CHECK (cycle_number >= 1),
  player_id uuid NOT NULL REFERENCES room_members(id),
  status text NOT NULL DEFAULT 'awaiting-roll'
    CHECK (status IN ('awaiting-roll', 'rolling', 'tilt-decision', 'completed', 'skipped')),
  deadline_at timestamptz NOT NULL,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  skip_reason text CHECK (skip_reason IN ('turn-timeout', 'roll-error-limit', 'disconnected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (game_id, sequence)
);

CREATE UNIQUE INDEX turns_one_active_per_game
  ON turns (game_id)
  WHERE status IN ('awaiting-roll', 'rolling', 'tilt-decision');

CREATE INDEX turns_deadline_index
  ON turns (deadline_at)
  WHERE status IN ('awaiting-roll', 'rolling', 'tilt-decision');

CREATE TABLE roll_attempts (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  turn_id uuid NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES room_members(id),
  command_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  seed bigint NOT NULL,
  throw_algorithm_version text NOT NULL,
  settle_algorithm_version text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('computed', 'awaiting-tilt', 'committed', 'rejected', 'error')),
  dice_values smallint[],
  judge_result jsonb,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  settle_reason text,
  reveal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  UNIQUE (game_id, command_id),
  UNIQUE (turn_id, attempt_number),
  CHECK (
    dice_values IS NULL
    OR (
      cardinality(dice_values) = 6
      AND dice_values <@ ARRAY[1, 2, 3, 4, 5, 6]::smallint[]
    )
  )
);

CREATE TABLE award_grants (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  roll_id uuid NOT NULL UNIQUE REFERENCES roll_attempts(id),
  player_id uuid NOT NULL REFERENCES room_members(id),
  tier text NOT NULL CHECK (tier IN ('duitang', 'sanhong', 'sijin', 'erju', 'yixiu')),
  grant_sequence integer NOT NULL CHECK (grant_sequence >= 1),
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, grant_sequence)
);

CREATE TABLE zhuangyuan_claims (
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES room_members(id),
  roll_id uuid NOT NULL UNIQUE REFERENCES roll_attempts(id),
  claim_sequence integer NOT NULL CHECK (claim_sequence >= 1),
  dice_values smallint[] NOT NULL,
  judge_result jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, player_id),
  CHECK (
    cardinality(dice_values) = 6
    AND dice_values <@ ARRAY[1, 2, 3, 4, 5, 6]::smallint[]
  )
);

CREATE TABLE game_events (
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision >= 1),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, revision)
);

CREATE INDEX roll_attempts_game_sequence_index ON roll_attempts (game_id, created_at, id);
CREATE INDEX award_grants_player_index ON award_grants (game_id, player_id);
