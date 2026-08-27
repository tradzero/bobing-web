ALTER TABLE games DROP CONSTRAINT games_host_player_id_fkey;
ALTER TABLE games
  ADD CONSTRAINT games_host_player_id_fkey
  FOREIGN KEY (host_player_id) REFERENCES room_members(id) ON DELETE CASCADE;

ALTER TABLE games DROP CONSTRAINT games_pool_completed_by_player_id_fkey;
ALTER TABLE games
  ADD CONSTRAINT games_pool_completed_by_player_id_fkey
  FOREIGN KEY (pool_completed_by_player_id) REFERENCES room_members(id) ON DELETE CASCADE;

ALTER TABLE game_players DROP CONSTRAINT game_players_player_id_fkey;
ALTER TABLE game_players
  ADD CONSTRAINT game_players_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES room_members(id) ON DELETE CASCADE;

ALTER TABLE turns DROP CONSTRAINT turns_player_id_fkey;
ALTER TABLE turns
  ADD CONSTRAINT turns_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES room_members(id) ON DELETE CASCADE;

ALTER TABLE roll_attempts DROP CONSTRAINT roll_attempts_player_id_fkey;
ALTER TABLE roll_attempts
  ADD CONSTRAINT roll_attempts_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES room_members(id) ON DELETE CASCADE;

ALTER TABLE award_grants DROP CONSTRAINT award_grants_player_id_fkey;
ALTER TABLE award_grants
  ADD CONSTRAINT award_grants_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES room_members(id) ON DELETE CASCADE;

ALTER TABLE zhuangyuan_claims DROP CONSTRAINT zhuangyuan_claims_player_id_fkey;
ALTER TABLE zhuangyuan_claims
  ADD CONSTRAINT zhuangyuan_claims_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES room_members(id) ON DELETE CASCADE;
