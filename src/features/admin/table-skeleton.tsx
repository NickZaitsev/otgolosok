const SKELETON_ROWS = 5;

/**
 * Placeholder rows hold a table's shape while its own request is in flight, so the editor never reads
 * stale rows as current. They are decorative: the loading label is announced by the desk-wide status line.
 *
 * `current` is the number of rows on screen; the placeholder keeps that height so the page does not jump.
 * `header` is the index of the column the table marks up as a row header — it gets a second, shorter bar
 * for the id or meta line those cells carry.
 */
export function skeletonRows(columns: number, current: number, header = 0) {
  const rows = current ? Math.min(current, 8) : SKELETON_ROWS;
  return Array.from({ length: rows }, (_, row) => <tr className="admin-skeleton-row" key={`skeleton-${row}`} aria-hidden="true">
    {Array.from({ length: columns }, (_, cell) => cell === header
      ? <th scope="row" key={cell}><span className="admin-skeleton-bar" /><span className="admin-skeleton-bar" /></th>
      : <td key={cell}><span className="admin-skeleton-bar" /></td>)}
  </tr>);
}
