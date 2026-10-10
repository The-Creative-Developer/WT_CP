import { createBrowserRouter } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { Home } from './routes/Home';
import { NotFound, RouteError } from './routes/NotFound';
import { Placeholder } from './routes/Placeholder';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Home /> },
      { path: 'dashboard', element: <Placeholder title="Dashboard" week="Week 1" /> },
      { path: 'rooms/:slug', element: <Placeholder title="Room" week="Week 1–2" /> },
      { path: 'challenges', element: <Placeholder title="Challenges" week="Week 3" /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
