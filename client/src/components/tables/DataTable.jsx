export default function DataTable({ columns, data, loading = false, emptyMessage = 'No records found' }) {
  if (loading) {
    return (
      <div className="card">
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading...</div>
      </div>
    );
  }
  if (!data || data.length === 0) {
    return <div className="card"><div className="empty-state"><h3>{emptyMessage}</h3></div></div>;
  }
  return (
    <div className="card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={row.id || i}>
                {columns.map((col) => (
                  <td key={col.key}>
                    {typeof col.render === 'function' ? col.render(row, i) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
