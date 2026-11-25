import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./pages/ProtectedRoute";

const HomePage = lazy(() => import("./pages/HomePage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const Expenses = lazy(() => import("./pages/Expenses"));
const ExpenseDetailPage = lazy(() => import("./pages/ExpenseDetailPage"));
const Groups = lazy(() => import("./pages/Groups"));
const GroupDetailsPage = lazy(() => import("./pages/GroupDetailPage"));
const GroupAnalyticsPage = lazy(() => import("./pages/GroupAnalyticsPage"));
const FriendsPage = lazy(() => import("./pages/FriendPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const TransactionPage = lazy(() => import("./pages/TransactionPage"));
const JoinPage = lazy(() => import("./pages/JoinPage"));
const LogoutConfirmationPage = lazy(() => import("./pages/LogoutConfirmationPage"));

export function App() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-slate-500 dark:bg-zinc-950 dark:text-zinc-400">
          Loading SplitMate...
        </div>
      }
    >
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        {/* Protected Routes */}
        <Route
          path="/group"
          element={
            <ProtectedRoute>
              <Groups />
            </ProtectedRoute>
          }
        />
        <Route
          path="/expenses"
          element={
            <ProtectedRoute>
              <Expenses />
            </ProtectedRoute>
          }
        />
        <Route
          path="/friends"
          element={
            <ProtectedRoute>
              <FriendsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/transactions"
          element={
            <ProtectedRoute>
              <TransactionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/join"
          element={
            <ProtectedRoute>
              <JoinPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/logout-confirmation"
          element={
            <ProtectedRoute>
              <LogoutConfirmationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Navigate to="/group" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/analytics"
          element={
            <ProtectedRoute>
              <Navigate to="/group" replace />
            </ProtectedRoute>
          }
        />
        <Route
          path="/groups/:groupId/analytics"
          element={
            <ProtectedRoute>
              <GroupAnalyticsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/groups/:groupId"
          element={
            <ProtectedRoute>
              <GroupDetailsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/expenses/:expenseId"
          element={
            <ProtectedRoute>
              <ExpenseDetailPage />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;