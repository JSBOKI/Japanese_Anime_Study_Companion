import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { api, postJson } from "./api";
import { Layout } from "./components/Layout";
import { SessionContext, type SessionState } from "./session";
import { HomePage } from "./pages/Home";
import { KnownPage } from "./pages/Known";
import { LessonPage } from "./pages/Lesson";
import { LevelPage } from "./pages/Level";
import { LoginPage } from "./pages/Login";
import { NewsPage } from "./pages/News";
import { NewsDeepPage } from "./pages/NewsDeep";
import { NewsStoryPage } from "./pages/NewsStory";
import { RollupPage } from "./pages/Rollup";
import { NewSeriesPage } from "./pages/NewSeries";
import { ReviewPage } from "./pages/Review";
import { SeriesPage } from "./pages/Series";

type Session = { required: boolean; authenticated: boolean };

export function App() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const load = () => {
      api<Session>("/api/session")
        .then(setSession)
        .catch(() => setSession({ required: false, authenticated: true }));
    };
    load();
    const onLocked = () => setSession({ required: true, authenticated: false });
    window.addEventListener("yomu-unauthorized", onLocked);
    return () => window.removeEventListener("yomu-unauthorized", onLocked);
  }, []);

  if (!session) return <p className="boot">Opening Yomu…</p>;
  if (session.required && !session.authenticated) {
    return <LoginPage onSuccess={() => setSession({ required: true, authenticated: true })} />;
  }

  const value: SessionState = {
    required: session.required,
    signOut: async () => {
      await postJson("/api/logout", {});
      setSession({ required: true, authenticated: false });
    },
  };

  return (
    <SessionContext.Provider value={value}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="new" element={<NewSeriesPage />} />
          <Route path="series/:id" element={<SeriesPage />} />
          <Route path="episodes/:id" element={<LessonPage />} />
          <Route path="news" element={<NewsPage />} />
          <Route path="news/rollup" element={<RollupPage />} />
          <Route path="news/:id/deeper" element={<NewsDeepPage />} />
          <Route path="news/:id" element={<NewsStoryPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="known" element={<KnownPage />} />
          <Route path="level" element={<LevelPage />} />
        </Route>
      </Routes>
    </SessionContext.Provider>
  );
}
