export default function EmptyState({ title, hint, action }) {
  return (
    <div className="club-empty">
      <h2>{title}</h2>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}
