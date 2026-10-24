import React from "react";
import ReactDOM from "react-dom/client";
import { AnimateUIProvider } from "@animate-ui/react/provider";
import "../theme.css";
import "../styles.css";
import "../controls.css";
import "../sidebar.css";
import "./studio.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AnimateUIProvider tempo={0.85}>
      <App />
    </AnimateUIProvider>
  </React.StrictMode>,
);
