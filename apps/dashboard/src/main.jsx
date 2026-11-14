import React from 'react';
import { createRoot } from 'react-dom/client';
import WhoopDashboard from '../../../integrations/whoop/dashboard/WhoopDashboard.jsx';
import WeatherStrip from '../../../integrations/weather/dashboard/WeatherStrip.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WhoopDashboard persistentContent={<WeatherStrip />} />
  </React.StrictMode>,
);