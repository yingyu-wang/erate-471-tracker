/** App shell with gradient navbar and nested route outlet. */

import { AppBar, Box, Container, Toolbar, Typography, Button } from "@mui/material";
import { Link as RouterLink, Outlet, useLocation } from "react-router-dom";
import WifiTetheringIcon from "@mui/icons-material/WifiTethering";

const navItems = [
  { label: "Dashboard", path: "/" },
  { label: "Applications", path: "/applications" },
  { label: "New Application", path: "/applications/new" },
];

export default function Layout() {
  const location = useLocation();

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" elevation={0}>
        <Toolbar sx={{ gap: 2 }}>
          <WifiTetheringIcon sx={{ fontSize: 32 }} />
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
            E-Rate 471 Tracker
          </Typography>
          {navItems.map((item) => {
            // Exact match for home; prefix match for nested routes like /applications/:id
            const active =
              item.path === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.path);
            return (
              <Button
                key={item.path}
                component={RouterLink}
                to={item.path}
                sx={{
                  color: "white",
                  bgcolor: active ? "rgba(255,255,255,0.2)" : "transparent",
                  "&:hover": { bgcolor: "rgba(255,255,255,0.15)" },
                }}
              >
                {item.label}
              </Button>
            );
          })}
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Outlet />
      </Container>
    </Box>
  );
}