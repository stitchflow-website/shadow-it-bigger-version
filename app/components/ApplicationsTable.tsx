import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Application } from "@/types/application";
import { CategoryLabel } from "./CategoryLabel";
import { formatDate } from "@/lib/utils";

interface ApplicationsTableProps {
  applications: Application[];
  isLoading?: boolean;
}

export function ApplicationsTable({ applications, isLoading = false }: ApplicationsTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Last Used</TableHead>
            <TableHead>Users</TableHead>
            <TableHead>Risk Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {applications.map((app) => (
            <TableRow key={app.id}>
              <TableCell className="font-medium">{app.name}</TableCell>
              <TableCell>
                <CategoryLabel category={app.category} isLoading={isLoading} />
              </TableCell>
              <TableCell>{formatDate(app.lastUsed)}</TableCell>
              <TableCell>{app.userCount}</TableCell>
              <TableCell>{app.riskScore}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
} 