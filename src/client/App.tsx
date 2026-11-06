/**
 * Route table for BeatSync. The Layout shell wraps every page; the Game
 * page receives songs via `?url=` / `?mode=` query params so refreshes
 * keep the session context.
 */
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { GamePage } from './pages/GamePage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { ProfilePage } from './pages/ProfilePage';
import { FriendsPage } from './pages/FriendsPage';
import { AuthPage } from './pages/AuthPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/game" element={<GamePage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/friends" element={<FriendsPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<HomePage />} />
      </Route>
    </Routes>
  );
}
