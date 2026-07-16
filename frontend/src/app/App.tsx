import { lazy, Suspense, useState, useMemo, useCallback, useEffect } from "react";
import { Toaster } from "./components/ui/sonner";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Login } from "./components/Login";
import { Sidebar } from "./components/Sidebar";
import { LegalPage } from "./components/LegalPage";

const Dashboard = lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const Orders = lazy(() => import('./components/Orders').then(m => ({ default: m.Orders })));
const Drivers = lazy(() => import('./components/Drivers').then(m => ({ default: m.Drivers })));
const Passengers = lazy(() => import('./components/Passengers').then(m => ({ default: m.Passengers })));
const Dispatch = lazy(() => import('./components/Dispatch').then(m => ({ default: m.Dispatch })));
const Regions = lazy(() => import('./components/Regions').then(m => ({ default: m.Regions })));
const Map = lazy(() => import('./components/Map').then(m => ({ default: m.Map })));
const Analytics = lazy(() => import('./components/Analytics').then(m => ({ default: m.Analytics })));

type PageType =
  | "dashboard"
  | "orders"
  | "drivers"
  | "passengers"
  | "dispatch"
  | "regions"
  | "map"
  | "analytics"
  | "daily-routes"
  ;

function MainApp() {
  const { user, isLoading } = useAuth();
  const [currentPage, setCurrentPage] = useState<PageType>("dashboard");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Оператор по умолчанию попадает на Заказы, а не на Главную
  useEffect(() => {
    if (user?.role === "operator" && currentPage === "dashboard") {
      setCurrentPage("orders");
    }
  }, [user?.role, currentPage]);

  const handleOrderClose = useCallback(() => {
    setSelectedOrderId(null);
  }, []);

  const renderPage = useMemo(() => {
    switch (currentPage) {
      case "dashboard":
        return <Dashboard />;
      case "orders":
        return <Orders selectedOrderId={selectedOrderId} onOrderClose={handleOrderClose} />;
      case "drivers":
        return <Drivers />;
      case "passengers":
        return <Passengers />;
      case "dispatch":
        return <Dispatch />;
      case "daily-routes":
        return <Dispatch initialTab="day" />;
      case "regions":
        return <Regions />;
      case "map":
        return <Map />;
      case "analytics":
        return <Analytics />;
      default:
        return <Dashboard />;
    }
  }, [currentPage, selectedOrderId, handleOrderClose]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Загрузка...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar currentPage={currentPage} setCurrentPage={setCurrentPage} />
      <main className="flex-1 overflow-auto">
        <div className="p-8"><Suspense fallback={<div className="flex min-h-64 items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-b-2 border-indigo-600" /></div>}>{renderPage}</Suspense></div>
      </main>
    </div>
  );
}

export default function App() {
  const legalRoute = window.location.pathname.replace(/\/+$/, '') || '/';
  if (legalRoute === '/privacy') return <LegalPage kind="privacy" />;
  if (legalRoute === '/terms') return <LegalPage kind="terms" />;
  if (legalRoute === '/account-deletion') return <LegalPage kind="account-deletion" />;
  if (legalRoute === '/support') return <LegalPage kind="support" />;
  return (
    <AuthProvider>
      <ThemeProvider>
        <MainApp />
        <Toaster position="top-right" richColors />
      </ThemeProvider>
    </AuthProvider>
  );
}
