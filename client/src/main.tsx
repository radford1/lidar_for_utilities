import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import Architecture from './pages/Architecture';
import TopNav from './components/TopNav';
import 'mapbox-gl/dist/mapbox-gl.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  <BrowserRouter>
    <TopNav />
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/architecture" element={<Architecture />} />
    </Routes>
  </BrowserRouter>
);


