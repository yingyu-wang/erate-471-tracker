import { useState, useEffect } from "react";
import { Box, CircularProgress, Typography, Paper } from "@mui/material";

interface LoadingScreenProps {
  onReady: () => void;
}

export default function LoadingScreen({ onReady }: LoadingScreenProps) {
  const [message, setMessage] = useState("Initializing USAC data...");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let intervalId: number;

    const checkReadiness = async () => {
      try {
        const response = await fetch("/api/health/ready");

        if (response.ok) {
          if (isMounted) {
            onReady();
          }
        } else if (response.status === 503) {
          const data = await response.json();
          if (isMounted) {
            setMessage(data.message || "Initializing USAC data...");
            setIsError(false);
          }
        }
      } catch (error) {
        if (isMounted) {
          setMessage("Unable to reach API. Retrying...");
          setIsError(true);
        }
      }
    };

    // Check immediately
    checkReadiness();

    // Then check every 2 seconds
    intervalId = window.setInterval(checkReadiness, 2000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [onReady]);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      }}
    >
      <Paper
        sx={{
          padding: 4,
          textAlign: "center",
          borderRadius: 2,
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.2)",
        }}
      >
        <CircularProgress
          size={60}
          sx={{ marginBottom: 2, color: isError ? "error.main" : "primary.main" }}
        />
        <Typography variant="h5" sx={{ marginTop: 2, fontWeight: 600 }}>
          E-Rate 471 Tracker
        </Typography>
        <Typography
          variant="body2"
          sx={{
            marginTop: 1,
            color: isError ? "error.main" : "text.secondary",
          }}
        >
          {message}
        </Typography>
        {isError && (
          <Typography variant="caption" sx={{ marginTop: 1, display: "block", color: "error.main" }}>
            Please wait while we reconnect...
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
