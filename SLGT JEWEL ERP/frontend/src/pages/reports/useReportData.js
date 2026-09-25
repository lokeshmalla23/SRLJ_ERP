import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import api from "@/lib/api";

const PAGE_SIZE = 25;

/**
 * Generic paginated report-endpoint hook — replaces the copy-pasted
 * useState/useEffect/axios pattern that every tab in the old Reports.jsx
 * monolith repeated. Endpoint must return either `{ total, data }` (paginated)
 * or `{ data }` (unpaginated aggregate) per the shared reportQuery.js contract
 * on the backend.
 */
export function useReportData(endpoint, params = {}, { pageSize = PAGE_SIZE, enabled = true } = {}) {
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["report", endpoint, params, page, pageSize],
    queryFn: async () => {
      const { data } = await api.get(endpoint, {
        params: { ...params, limit: pageSize, offset: (page - 1) * pageSize },
      });
      return data;
    },
    enabled,
    placeholderData: keepPreviousData,
  });

  return {
    rows: query.data?.data || [],
    total: query.data?.total ?? (query.data?.data || []).length,
    totals: query.data?.totals || null,
    extra: query.data,
    loading: query.isLoading,
    fetching: query.isFetching,
    error: query.error,
    page,
    setPage,
    pageSize,
    refetch: query.refetch,
  };
}
