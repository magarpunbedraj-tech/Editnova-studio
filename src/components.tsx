import React from "react";

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message || String(e) };
  }
  render() {
    return this.state.error ? (
      <main className="crash">
        <h1>EditNova hit a problem</h1>
        <p>
          Your work up to the last couple of seconds is in the recovery
          checkpoint. Restart EditNova and choose <b>Recover last session</b>.
        </p>
        <pre>{this.state.error}</pre>
        <button className="primary" onClick={() => location.reload()}>
          Restart editor
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
