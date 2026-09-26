import { BrandMark } from "@/components/app/BrandMark";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { DataProvider } from "@/contexts/DataContext";
import Login from "@/pages/Login";
import MainApp from "@/pages/MainApp";

const ACCESS_MESSAGES = {
  no_role: "Aap ka account abhi kisi role se link nahi hai. Admin se kahein ke Settings → User Management se aap ko access dein.",
  disabled: "Aap ka account disable kar diya gaya hai. Admin se rabta karein.",
  error: "Account details load nahi ho sakin. Internet check kar ke dobara login karein.",
};

function NoAccess({ reason }: { reason: keyof typeof ACCESS_MESSAGES }) {
  const { user, logout } = useAuth();
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand"><BrandMark size={38} color="#fff" /></div>
        <h1>Access Pending</h1>
        <p className="login-subtitle">{user?.email}</p>
        <div className="login-error">{ACCESS_MESSAGES[reason]}</div>
        <button className="btnSolid login-btn" onClick={logout}>Logout</button>
      </div>
    </div>
  );
}

function AppContent() {
  const { user, loading, access } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <BrandMark size={44} color="#fff" />
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) return <Login />;
  if (access !== "ok") return <NoAccess reason={access} />;

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
