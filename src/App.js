import { useState } from 'react';
import Auth from './components/Auth';
import Chat from './components/Chat';
import YouTubeDownload from './components/YouTubeDownload';
import './App.css';

function App() {
  const [page, setPage] = useState('chat');
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('chatapp_user');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.username) return parsed;
      return { username: String(raw) };
    } catch {
      return { username: raw };
    }
  });

  const handleLogin = (userObj) => {
    if (!userObj || !userObj.username) return;
    localStorage.setItem('chatapp_user', JSON.stringify(userObj));
    setUser(userObj);
  };

  const handleLogout = () => {
    localStorage.removeItem('chatapp_user');
    setUser(null);
  };

  if (user) {
    if (page === 'youtube') {
      return (
        <YouTubeDownload
          username={user.username}
          firstName={user.firstName}
          lastName={user.lastName}
          onLogout={handleLogout}
          setPage={setPage}
        />
      );
    }
    return (
      <Chat
        username={user.username}
        firstName={user.firstName}
        lastName={user.lastName}
        onLogout={handleLogout}
        setPage={setPage}
      />
    );
  }
  return <Auth onLogin={handleLogin} />;
}

export default App;
