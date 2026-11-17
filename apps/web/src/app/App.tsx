import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { queryClient } from '../lib/query';
import { useApp, useSession } from '../state/app';
import { backgroundRefresh } from '../sync/catalogSync';
import { Shell } from './Shell';
import { HomePage } from '../features/home/HomePage';
import { CatalogPage } from '../features/catalog/CatalogPage';
import { DetailsPage } from '../features/details/DetailsPage';
import { SearchPage } from '../features/search/SearchPage';
import { AddSourcePage, SourcesPage } from '../features/sources/SourcesPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { ProfilesPage, ensureDefaultProfile, useProfiles } from '../features/profiles/ProfilesPage';
import { LivePage } from '../features/live/LivePage';
import { LivePlayerScreen } from '../features/live/LivePlayerScreen';
import { MultiView } from '../features/live/MultiView';
import { ReminderWatcher } from '../components/Reminders';
import { AccountPage, LinkPage } from '../features/account/AccountPage';
import { setCommandHandler } from '../cloud/auth';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../components/ui';
import { PlayerScreen } from '../player/ui/PlayerScreen';

/** Runs commands sent from another device (Send to TV, search from the phone). */
function RemoteCommands() {
  const nav = useNavigate();
  useEffect(() => {
    setCommandHandler((c) => {
      if (c.type === 'play') nav(c.path);
      else if (c.type === 'search') nav(`/search?q=${encodeURIComponent(c.q)}`);
      else if (c.type === 'key') window.dispatchEvent(new KeyboardEvent('keydown', { key: c.key, bubbles: true }));
    });
  }, [nav]);
  return null;
}

/** Picks the active profile: the only unlocked one automatically, otherwise the picker. */
function ProfileGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const profiles = useProfiles();
  const profileId = useApp((s) => s.profileId);
  const setProfileId = useApp((s) => s.setProfileId);
  const unlocked = useSession((s) => s.unlocked);
  const loc = useLocation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    ensureDefaultProfile(t('profiles.me')).then(() => setReady(true));
  }, [t]);

  const current = profiles?.find((p) => p.id === profileId);
  const autoPick = !!profiles && !current && profiles.length === 1 && !profiles[0].pinHash ? profiles[0].id : null;
  useEffect(() => {
    if (autoPick) setProfileId(autoPick);
  }, [autoPick, setProfileId]);

  if (!ready || !profiles || profiles.length === 0 || autoPick) return <div className="flex h-full items-center justify-center"><Spinner className="size-8" /></div>;
  if (loc.pathname.startsWith('/profiles')) return <>{children}</>;
  if (!current) return <Navigate to="/profiles" replace />;
  if (current.pinHash && unlocked !== current.id) return <Navigate to="/profiles" replace />;
  return <>{children}</>;
}

export function App() {
  useEffect(() => {
    const id = setTimeout(() => backgroundRefresh(), 1500);
    return () => clearTimeout(id);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ProfileGate>
          <ReminderWatcher />
          <RemoteCommands />
          <Routes>
            <Route path="/profiles" element={<ProfilesPage />} />
            <Route path="/play/:kind/:playlistId/:id" element={<PlayerScreen />} />
            <Route path="/live/:playlistId/:id" element={<LivePlayerScreen />} />
            <Route path="/multiview" element={<MultiView />} />
            <Route
              path="*"
              element={
                <Shell>
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/search" element={<SearchPage />} />
                    <Route path="/movies" element={<CatalogPage key="movie" kind="movie" />} />
                    <Route path="/series" element={<CatalogPage key="series" kind="series" />} />
                    <Route path="/live" element={<LivePage />} />
                    <Route path="/movie/:playlistId/:id" element={<DetailsPage key="m" kind="movie" />} />
                    <Route path="/series/:playlistId/:id" element={<DetailsPage key="s" kind="series" />} />
                    <Route path="/sources" element={<SourcesPage />} />
                    <Route path="/sources/add" element={<AddSourcePage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/account" element={<AccountPage />} />
                    <Route path="/link" element={<LinkPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Shell>
              }
            />
          </Routes>
        </ProfileGate>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
