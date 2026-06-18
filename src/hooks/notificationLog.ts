import { useSyncExternalStore } from "react";
import {
  getNotificationLog,
  type LoggedNotice,
  subscribeNotificationLog,
} from "../lib/notificationLog.ts";

/** Subscribe to the shown-toast history (re-renders on change). */
export function useNotificationLog(): LoggedNotice[] {
  return useSyncExternalStore(
    subscribeNotificationLog,
    getNotificationLog,
    getNotificationLog,
  );
}
