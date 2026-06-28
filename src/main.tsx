import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { installTauriProxy } from "./infrastructure/tauri";
import { AppRoot } from "./presentation/AppRoot";

// Install proxy before any API calls can happen
installTauriProxy();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
