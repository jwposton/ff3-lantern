import { useQuery } from "@tanstack/react-query"

import { fetchHealth } from "@/lib/healthApi"

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    staleTime: 1000 * 60 * 5,
  })
}
