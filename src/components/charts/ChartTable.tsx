interface ChartTableProps {
  label: string
  columns: string[]
  rows: Array<Array<string>>
}

export function ChartTable({ label, columns, rows }: ChartTableProps) {
  return (
    <details className="chart-details">
      <summary>数据明细</summary>
      <div className="chart-table-wrap">
        <table className="chart-table">
          <caption className="sr-only">{label}数据表</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.join('|')}>
                {row.map((cell, index) =>
                  index === 0 ? (
                    <th key={`${cell}-${index}`} scope="row">
                      {cell}
                    </th>
                  ) : (
                    <td key={`${cell}-${index}`}>{cell}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
