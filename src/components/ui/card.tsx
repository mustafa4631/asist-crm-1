import { cn } from "@/lib/utils";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("glass-card overflow-hidden rounded-3xl", className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between border-b border-zinc-100 px-6 py-4", className)}>
      <h3 className="text-sm font-bold tracking-tight text-zinc-900">{title}</h3>
      {action}
    </div>
  );
}

export function CardBody({ className, children, flush }: { className?: string; children: React.ReactNode; flush?: boolean }) {
  return <div className={cn(flush ? "p-0" : "p-6", className)}>{children}</div>;
}

export function DataTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function DataTableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-zinc-100 bg-zinc-50/80">{children}</tr>
    </thead>
  );
}

export function DataTableHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn("px-6 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-400", className)}>
      {children}
    </th>
  );
}

export function DataTableBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-zinc-50">{children}</tbody>;
}

export function DataTableRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <tr className={cn("transition-colors hover:bg-indigo-50/30", className)}>{children}</tr>
  );
}

export function DataTableCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-6 py-4 text-zinc-700", className)}>{children}</td>;
}

export function EmptyState({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-sm text-zinc-400">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
