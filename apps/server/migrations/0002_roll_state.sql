ALTER TABLE games
  ADD COLUMN bonus_queue uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE roll_attempts
  ADD COLUMN roll_sequence integer,
  ADD COLUMN award_tier text
    CHECK (award_tier IS NULL OR award_tier IN ('zhuangyuan', 'duitang', 'sanhong', 'sijin', 'erju', 'yixiu')),
  ADD COLUMN allocation_reason text
    CHECK (
      allocation_reason IS NULL
      OR allocation_reason IN (
        'granted',
        'no-prize',
        'out-of-stock',
        'zhuangyuan-claim',
        'bonus-no-allocation'
      )
    );

CREATE UNIQUE INDEX roll_attempts_game_roll_sequence
  ON roll_attempts (game_id, roll_sequence)
  WHERE roll_sequence IS NOT NULL;
