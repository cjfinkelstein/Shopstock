import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth";
import TechLayout from "./components/TechLayout";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminActivity from "./pages/admin/Activity";
import AdminCalendar from "./pages/admin/Calendar";
import AdminDashboard from "./pages/admin/Dashboard";
import EstimateDetail from "./pages/admin/EstimateDetail";
import AdminEstimates from "./pages/admin/Estimates";
import AdminExpenses from "./pages/admin/Expenses";
import PublicEstimate from "./pages/PublicEstimate";
import AdminItems from "./pages/admin/Items";
import AdminJobs from "./pages/admin/Jobs";
import JobDetail from "./pages/admin/JobDetail";
import AdminReceive from "./pages/admin/Receive";
import AdminReports from "./pages/admin/Reports";
import AdminSettings from "./pages/admin/Settings";
import AdminStock from "./pages/admin/Stock";
import AdminTrucks from "./pages/admin/Trucks";
import AdminLogin from "./pages/AdminLogin";
import TapIn from "./pages/TapIn";
import Activity from "./pages/tech/Activity";
import Cart from "./pages/tech/Cart";
import Home from "./pages/tech/Home";
import ItemSheet from "./pages/tech/ItemSheet";
import MyHours from "./pages/tech/MyHours";
import Search from "./pages/tech/Search";
import Trucks from "./pages/tech/Trucks";

export default function App() {
  const { user, loading } = useAuth();

  // Public, unauthenticated estimate-view link -- must work regardless of
  // login state or session-loading status, since the customer clicking an
  // emailed link has no ShopStock account and no token in this browser.
  if (window.location.pathname.startsWith("/estimate/")) {
    return (
      <Routes>
        <Route path="/estimate/:token" element={<PublicEstimate />} />
      </Routes>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<TapIn />} />
        <Route path="/admin-login" element={<AdminLogin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<TechLayout />}>
        <Route path="/home" element={<Home />} />
        <Route path="/search" element={<Search />} />
        {/* scanner flow retired — old links land on Find */}
        <Route path="/scan" element={<Navigate to="/search" replace />} />
        <Route path="/truck" element={<Trucks />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/item/:id" element={<ItemSheet />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/my-hours" element={<MyHours />} />
      </Route>
      {user.role === "admin" && (
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
          <Route path="activity" element={<AdminActivity />} />
          <Route path="stock" element={<AdminStock />} />
          <Route path="items" element={<AdminItems />} />
          <Route path="receive" element={<AdminReceive />} />
          <Route path="jobs" element={<AdminJobs />} />
          <Route path="jobs/:id" element={<JobDetail />} />
          <Route path="estimates" element={<AdminEstimates />} />
          <Route path="estimates/:id" element={<EstimateDetail />} />
          <Route path="trucks" element={<AdminTrucks />} />
          <Route path="worker-map" element={<Navigate to="/admin/calendar" replace />} />
          <Route path="calendar" element={<AdminCalendar />} />
          <Route path="expenses" element={<AdminExpenses />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
      )}
      <Route
        path="*"
        element={<Navigate to={user.role === "admin" ? "/admin" : "/home"} replace />}
      />
    </Routes>
  );
}
