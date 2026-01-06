import React from 'react';
import { NavLink } from 'react-router-dom';

export default function TopNav() {
  const linkStyle: React.CSSProperties = {
    color: '#e6eef7',
    textDecoration: 'none',
    padding: '6px 10px',
    borderRadius: 6
  };
  const activeStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.15)'
  };
  return (
    <div style={{ position: 'fixed', bottom: 10, left: 10, zIndex: 1000, background: 'rgba(31,42,60,0.9)', padding: 6, borderRadius: 8, display: 'flex', gap: 8 }}>
      <NavLink to="/" end style={({ isActive }) => ({ ...linkStyle, ...(isActive ? activeStyle : {}) })}>Map</NavLink>
      <NavLink to="/architecture" style={({ isActive }) => ({ ...linkStyle, ...(isActive ? activeStyle : {}) })}>Architecture</NavLink>
    </div>
  );
}


