import React from 'react';
import { createRoot } from 'react-dom/client';
import WhoopDashboard from '../../../integrations/whoop/dashboard/WhoopDashboard.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WhoopDashboard />
  </React.StrictMode>,
);