/** Top-level route definitions for the single-page application. */

import { useState, useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import LoadingScreen from "./components/LoadingScreen";
import Dashboard from "./pages/Dashboard";
import ApplicationList from "./pages/ApplicationList";
import ApplicationDetail from "./pages/ApplicationDetail";
import ApplicationForm from "./pages/ApplicationForm";

export default function App() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Check if API is already ready on mount
    const checkReady = async () => {
      try {
        const response = await fetch("/api/health/ready");
        if (response.ok) {
          setIsReady(true);
        }
      } catch {
        // Will retry via LoadingScreen polling
      }
    };

    checkReady();
  }, []);

  if (!isReady) {
    return <LoadingScreen onReady={() => setIsReady(true)} />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="applications" element={<ApplicationList />} />
        <Route path="applications/new" element={<ApplicationForm />} />
        <Route path="applications/:id" element={<ApplicationDetail />} />
      </Route>
    </Routes>
  );
}