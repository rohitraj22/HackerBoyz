import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const links = [
  { label: 'Home', to: '/' },
  { label: 'Asset Discovery', to: '/dashboard' },
  { label: 'Asset Inventory', to: '/history' },
  { label: 'CBOM', to: '/cbom' },
  { label: 'Posture of PQC', to: '/pqc-posture' },
  { label: 'Cyber Rating', to: '/cyber-rating' },
  { label: 'Reporting', to: '/reporting' },
];

export default function Navbar() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <aside className="navbar">
      <div className="navbar-brand">
        <NavLink to="/">Quantum Scanner</NavLink>
      </div>

      <nav className="navbar-nav">
        {links.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="navbar-actions">
        {user ? (
          <div className="navbar-user" aria-label="Current user">
            <span className="navbar-user-line">Welcome {user.name}</span>
          </div>
        ) : null}
        <button className="navbar-logout-btn" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </aside>
  );
}