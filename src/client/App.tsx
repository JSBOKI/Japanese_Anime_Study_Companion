import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/Home";
import { KnownPage } from "./pages/Known";
import { LessonPage } from "./pages/Lesson";
import { NewSeriesPage } from "./pages/NewSeries";
import { ReviewPage } from "./pages/Review";
import { SeriesPage } from "./pages/Series";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="new" element={<NewSeriesPage />} />
        <Route path="series/:id" element={<SeriesPage />} />
        <Route path="episodes/:id" element={<LessonPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="known" element={<KnownPage />} />
      </Route>
    </Routes>
  );
}
