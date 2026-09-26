import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { DataProvider } from "@/contexts/DataContext";
import Login from "@/pages/Login";
import MainApp from "@/pages/MainApp";

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="login-logo">DT</div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <DataProvider>
      <MainApp />
    </DataProvider>
  );
}

const App = () => (
  <AuthProvider>
    <AppContent />
  </AuthProvider>
);

export default App;
