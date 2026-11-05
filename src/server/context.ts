/**
 * Composition root — wires config, database and every service exactly once.
 * Tests build isolated contexts with temp databases via the same factory.
 */
import type { AppConfig } from './config';
import { Database } from './db/database';
import { AuthService } from './services/authService';
import { ProfileService } from './services/profileService';
import { SongService } from './services/songService';
import { ChallengeService } from './services/challengeService';
import { ScoreService } from './services/scoreService';
import { LeaderboardService } from './services/leaderboardService';
import { SocialService } from './services/socialService';
import { BattleService } from './services/battleService';

export interface AppContext {
  config: AppConfig;
  db: Database;
  auth: AuthService;
  profile: ProfileService;
  songs: SongService;
  challenges: ChallengeService;
  scores: ScoreService;
  leaderboard: LeaderboardService;
  social: SocialService;
  battles: BattleService;
}

export function createContext(config: AppConfig): AppContext {
  const db = new Database(config.dbPath);
  const auth = new AuthService(db, config);
  const profile = new ProfileService(db, auth);
  const songs = new SongService(db);
  const challenges = new ChallengeService(db);
  const scores = new ScoreService(db, auth, profile, songs, challenges);
  const leaderboard = new LeaderboardService(db);
  const social = new SocialService(db);
  const battles = new BattleService(db, songs, profile);

  return { config, db, auth, profile, songs, challenges, scores, leaderboard, social, battles };
}
