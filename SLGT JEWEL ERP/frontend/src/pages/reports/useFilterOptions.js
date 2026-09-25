import { useEffect, useState } from "react";
import api from "@/lib/api";

/** Shared master-data lookups (category/counter/purity/vendor/employee/metal) for every report filter bar. */
export function useFilterOptions() {
  const [categories, setCategories] = useState([]);
  const [counters, setCounters] = useState([]);
  const [purities, setPurities] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [metalTypes, setMetalTypes] = useState([]);

  useEffect(() => {
    api.get("/categories").then(({ data }) => setCategories(Array.isArray(data) ? data : data?.data || [])).catch(() => {});
    api.get("/settings/counters").then(({ data }) => setCounters(data?.data || [])).catch(() => {});
    api.get("/catalog/purities").then(({ data }) => setPurities(Array.isArray(data) ? data : data?.data || [])).catch(() => {});
    api.get("/vendors").then(({ data }) => setVendors(Array.isArray(data) ? data : data?.data || [])).catch(() => {});
    api.get("/employees").then(({ data }) => setEmployees(Array.isArray(data) ? data : data?.data || [])).catch(() => {});
    api.get("/catalog/metal-types").then(({ data }) => setMetalTypes(Array.isArray(data) ? data : data?.data || [])).catch(() => {});
  }, []);

  const topCategories = categories.filter((c) => !c.parent_id && !c.deleted_at);
  const subcategoriesFor = (parentId) => categories.filter((c) => c.parent_id === parentId && !c.deleted_at);

  return { categories: topCategories, subcategoriesFor, counters, purities, vendors, employees, metalTypes };
}
