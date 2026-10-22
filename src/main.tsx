import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components";
import "./style.css";

try {
  document.documentElement.dataset.theme = JSON.parse(localStorage.getItem("theme") || '"dark"');
} catch {
  document.documentElement.dataset.theme = "dark";
}

// Block the webview's own context menu and file drops so the app feels native.
window.addEventListener("contextmenu", (e) => {
  if (!(e.target as HTMLElement).matches("input, textarea")) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
