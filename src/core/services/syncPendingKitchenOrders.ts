/**
 * Compatibility entrypoint for callers that still import the kitchen sync
 * service from the legacy `core/services` location.
 *
 * The canonical implementation lives in `core/offline` so offline lifecycle,
 * lease recovery, tenant/branch guards, and retry behavior cannot diverge
 * between two copies of the synchronizer.
 */
export * from "../offline/syncPendingKitchenOrders";
