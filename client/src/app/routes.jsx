import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import RequireAuth from '../features/auth/RequireAuth.jsx';
import AuthLayout from '../layouts/AuthLayout.jsx';
import AppLayout from '../layouts/AppLayout.jsx';
import { RouteSpinner } from '../components/feedback/Loading.jsx';

const LoginPage = lazy(() => import('../features/auth/LoginPage.jsx'));
const GpaPage = lazy(() => import('../features/gpa/GpaPage.jsx'));
const InfoPage = lazy(() => import('../features/info/InfoPage.jsx'));
const SchedulePage = lazy(() => import('../features/schedule/SchedulePage.jsx'));
const LeaderboardPage = lazy(() => import('../features/leaderboard/LeaderboardPage.jsx'));
const WordFmtPage = lazy(() => import('../features/wordfmt/WordFmtPage.jsx'));
const SurveyPage = lazy(() => import('../features/survey/SurveyPage.jsx'));
const EnglishPage = lazy(() => import('../features/english/EnglishPage.jsx'));
const EnrollmentPage = lazy(() => import('../features/enrollment/EnrollmentPage.jsx'));
const LearningPage = lazy(() => import('../features/learning/LearningPage.jsx'));
const CourseLearningPage = lazy(() => import('../features/learning/CourseLearningPage.jsx'));
const ClansPage = lazy(() => import('../features/clans/ClansPage.jsx'));
const ClanPage = lazy(() => import('../features/clans/ClanPage.jsx'));
const ConfessionPage = lazy(() => import('../features/confession/ConfessionPage.jsx'));
const NotFoundPage = lazy(() => import('../features/NotFoundPage.jsx'));

function Lazy({ children }) { return <Suspense fallback={<RouteSpinner />}>{children}</Suspense>; }

export default function AppRoutes() {
  return <Routes>
    <Route element={<AuthLayout />}><Route path="/login" element={<Lazy><LoginPage /></Lazy>} /></Route>
    <Route path="/" element={<RequireAuth><AppLayout /></RequireAuth>}>
      <Route index element={<Navigate to="/gpa" replace />} />
      <Route path="gpa" element={<Lazy><GpaPage /></Lazy>} />
      <Route path="info" element={<Lazy><InfoPage /></Lazy>} />
      <Route path="schedule" element={<Lazy><SchedulePage /></Lazy>} />
      <Route path="leaderboard" element={<Lazy><LeaderboardPage /></Lazy>} />
      <Route path="wordfmt" element={<Lazy><WordFmtPage /></Lazy>} />
      <Route path="survey" element={<Lazy><SurveyPage /></Lazy>} />
      <Route path="english" element={<Lazy><EnglishPage /></Lazy>} />
      <Route path="enrollment" element={<Lazy><EnrollmentPage /></Lazy>} />
      <Route path="learning" element={<Lazy><LearningPage /></Lazy>} />
      <Route path="learning/:courseCode" element={<Lazy><CourseLearningPage /></Lazy>} />
      <Route path="clans" element={<Lazy><ClansPage /></Lazy>} />
      <Route path="clans/:clanId" element={<Lazy><ClanPage /></Lazy>} />
      <Route path="confession" element={<Lazy><ConfessionPage /></Lazy>} />
      <Route path="*" element={<Lazy><NotFoundPage /></Lazy>} />
    </Route>
    <Route path="*" element={<Lazy><NotFoundPage /></Lazy>} />
  </Routes>;
}
