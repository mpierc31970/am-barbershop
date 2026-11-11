// 14 WR-E01: hub handlers catch a thrown server action (network drop, deploy skew, a server
// throw) and show P14_COPY.ERR_GENERIC. Next's redirect / notFound are control flow, not
// failures, so they pass through. One rule for staff and hub: re-exported, not copied.
export { rethrowControlFlow } from "../staff/dialogs/useStaffAction";
