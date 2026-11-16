export default function DashboardLoadError({ message, onRetry }) {
  return (
    <section className="card dashboard-panel" role="alert">
      <div className="empty-state">
        <h3>Overview unavailable</h3>
        <p>{message}</p>
        <button className="btn btn-primary" type="button" onClick={onRetry}>Try again</button>
      </div>
    </section>
  );
}
