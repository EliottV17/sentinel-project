import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createMonitor, deleteMonitor } from "../../app/api/endpoints";

/**
 * Monitor mutations. Create invalidates in `onSuccess` (the new row appears
 * immediately); delete invalidates in `onSettled` because even a 404 means
 * the cached list may be stale.
 */
export function useCreateMonitor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMonitor,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monitors"] });
    },
  });
}

export function useDeleteMonitor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMonitor,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["monitors"] });
    },
  });
}