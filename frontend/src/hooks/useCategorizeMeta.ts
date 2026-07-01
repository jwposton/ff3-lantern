import { useQuery } from "@tanstack/react-query"

import { fetchMeta } from "@/lib/categorizeApi"

export function useCategorizeMeta() {
  return useQuery({
    queryKey: ["categorizeMeta"],
    queryFn: fetchMeta,
    staleTime: 1000 * 60 * 5,
  })
}
