import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/** Generic page-level skeleton used while a route is loading its first batch of data. */
export function PageSkeleton({ rows = 6, title = true }: { rows?: number; title?: boolean }) {
  return (
    <div className="space-y-4 animate-[soft-rise_0.4s_ease-out]" aria-busy="true" aria-label="Loading">
      {title && (
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      )}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" style={{ opacity: 1 - i * 0.08 }} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
