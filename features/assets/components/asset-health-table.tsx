import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/features/assets/components/badges";
import type { AssetHealthRow } from "@/features/assets/queries";
import {
  formatDateTime,
  formatInteger,
  formatNumber,
  formatPercent,
} from "@/features/assets/utils/format";

/**
 * Fleet health table. A Server Component: the rows arrive as props from
 * `getAssetHealth`, so no client fetching is involved.
 */
export function AssetHealthTable({ rows }: { rows: AssetHealthRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Asset</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Readings</TableHead>
          <TableHead className="text-right">Faults</TableHead>
          <TableHead className="text-right">Open</TableHead>
          <TableHead className="text-right">Fault rate</TableHead>
          <TableHead className="text-right">Mean torque</TableHead>
          <TableHead className="text-right">Mean wear</TableHead>
          <TableHead>Last reading</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const rate = row.readings === 0 ? 0 : row.failures / row.readings;
          return (
            <TableRow key={row.id}>
              <TableCell>
                <a
                  href={`/assets/${row.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.name}
                </a>
                <p className="text-xs text-muted-foreground">
                  {row.manufacturer} {row.model}
                  {row.site ? ` · ${row.site}` : ""}
                </p>
              </TableCell>
              <TableCell>
                <StatusBadge status={row.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatInteger(row.readings)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatInteger(row.failures)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.unresolved > 0 ? (
                  <span className="font-medium text-destructive">
                    {row.unresolved}
                  </span>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPercent(rate)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.meanTorque)} Nm
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.meanToolWear, 0)} min
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDateTime(row.lastReadingAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
