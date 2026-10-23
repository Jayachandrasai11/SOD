import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import { AppProvider, useApp } from "./context/AppContext";
import { TooltipProvider } from "./components/ui/misc";
import "./index.css";

function ThemedToaster() {
  const { theme } = useApp();
  return <Toaster theme={theme} position="bottom-right" richColors closeButton />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <TooltipProvider delayDuration={200}>
          <App />
          <ThemedToaster />
        </TooltipProvider>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
