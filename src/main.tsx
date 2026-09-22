import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { BackendGate } from "./components/layout/BackendGate";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <BackendGate>
        <App />
      </BackendGate>
    </HashRouter>
  </React.StrictMode>
);
