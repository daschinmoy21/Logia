import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { isMobileShell } from "./mobile/detect";

// The phone shell is its own bundle, so the desktop workspace never loads it.
const MobileApp = lazy(() => import("./mobile/MobileApp"));
const mobile = isMobileShell();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {mobile ? (
      <Suspense fallback={null}>
        <MobileApp />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
