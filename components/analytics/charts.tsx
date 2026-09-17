import { dateLabel, moneyLabel } from "@/lib/format/human";
import type { DeclineRow, MrrPoint } from "@/lib/analytics/metrics";

// Weekly MRR as plain SVG bars. Values are labeled on the first and last bar; the table view is the exact data.
export function MrrBars({ points, currency, now }: { points: MrrPoint[]; currency: string; now: number }) {
  const max = Math.max(...points.map((p) => p.mrr), 1);
  const width = 640;
  const height = 150;
  const gap = 6;
  const bar = (width - gap * (points.length - 1)) / points.length;
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${width} ${height + 34}`} className="w-full max-w-3xl" role="img" aria-label="Monthly recurring revenue by week">
        {points.map((p, i) => {
          const h = Math.max(1, (p.mrr / max) * height);
          const x = i * (bar + gap);
          const last = i === points.length - 1;
          return (
            <g key={p.at}>
              <rect x={x} y={height - h} width={bar} height={h} className={last ? "fill-foreground" : "fill-muted-foreground/40"}>
                <title>{`${dateLabel(p.at, now)}: ${moneyLabel(p.mrr, currency)}, ${p.subscriptions} subscriptions`}</title>
              </rect>
              {(i === 0 || last || i % 4 === 0) && (
                <text x={x + bar / 2} y={height + 14} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {dateLabel(p.at, now)}
                </text>
              )}
              {(i === 0 || last) && (
                <text x={x + bar / 2} y={height + 30} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
                  {moneyLabel(p.mrr, currency)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function DeclineTable({ rows, label }: { rows: DeclineRow[]; label: string }) {
  const max = Math.max(...rows.map((r) => r.rate), 0.0001);
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>{label}</th>
          <th className="num">Attempts</th>
          <th className="num">Failed</th>
          <th className="num">Decline rate</th>
          <th className="w-40" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{label === "Brand" ? r.key.charAt(0).toUpperCase() + r.key.slice(1) : r.key}</td>
            <td className="num">{r.attempts}</td>
            <td className="num">{r.failed}</td>
            <td className="num">{(r.rate * 100).toFixed(1)}%</td>
            <td>
              <div className="h-2 bg-foreground/70" style={{ width: `${(r.rate / max) * 100}%` }} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
