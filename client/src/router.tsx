import { createBrowserRouter } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { LoginPage, RegisterPage } from './features/auth/AuthPages';
import { GuestOnly, RequireAuth } from './features/auth/RouteGuards';
import { Dashboard } from './routes/Dashboard';
import { Home } from './routes/Home';
import { NotFound, RouteError } from './routes/NotFound';
import { Placeholder } from './routes/Placeholder';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Home /> },
      { path: 'challenges', element: <Placeholder title="Challenges" week="Week 3" /> },
      {
        element: <GuestOnly />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'register', element: <RegisterPage /> },
        ],
      },
      {
        // [CONCEPT: Layout Routes] One guard protects every page nested under it.
        element: <RequireAuth />,
        children: [
          { path: 'dashboard', element: <Dashboard /> },
          {
            path: 'rooms/:slug',
            // [CONCEPT: Route-Based Code Splitting] The room page (chat, Markdown, Socket.IO, the run panel) is only
            // downloaded when a room is opened, so the login page and dashboard stay light. Monaco is split further
            // still (see RoomPage).
            lazy: async () => ({ Component: (await import('./routes/RoomPage')).RoomPage }),
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
