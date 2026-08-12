import type { JSX } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './app-shell/AppShell.js';

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />} />
      </Routes>
    </BrowserRouter>
  );
}
