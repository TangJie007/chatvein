import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { EmbeddingProvider } from "./components/embedding/EmbeddingProvider";
import { BackendGate } from "./components/layout/BackendGate";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary>
    <HashRouter>
      <BackendGate>
        <EmbeddingProvider>
          <App />
        </EmbeddingProvider>
      </BackendGate>
    </HashRouter>
  </ErrorBoundary>
);
