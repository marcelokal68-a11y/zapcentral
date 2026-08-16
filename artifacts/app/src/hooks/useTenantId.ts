/**
 * Provides the current tenant ID from the user's tenant memberships.
 * For now returns the first active tenant.
 */
import { useQuery } from "@tanstack/react-query";

interface TenantItem {
  id: number;
  name: string;
  slug: string;
  role: string;
  status: string;
}

export function useTenantId(): number | null {
  const { data } = useQuery({
    queryKey: ["me-tenants"],
    queryFn: async () => {
      const res = await fetch("/api-server/api/me/tenants", {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json() as Promise<TenantItem[]>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const active = data?.find((t) => t.status === "active");
  return active?.id ?? null;
}
