import { useEffect, useState } from "react";
import type { SurfaceId } from "../components/CommandBar";
import { notificationPermission, type NotifyPermission } from "../lib/notify";
import { useLatestReply } from "./useLatestReply";

/**
 * Whether the machine lets the watch put a notification up, as the panels
 * that show it read it.
 *
 * Read once on open and again whenever a panel that shows it is opened: the
 * answer changes the moment a watch first asks Windows, and a reader who went
 * looking after a warning did not arrive is opening a panel to do it.
 */
export function useNotificationPermission(
  activeSurface: SurfaceId,
  clock: number,
): NotifyPermission {
  const [notifications, setNotifications] =
    useState<NotifyPermission>("unasked");
  const latestPermission = useLatestReply();
  useEffect(() => {
    const reply = latestPermission();
    void notificationPermission().then((answer) => {
      if (reply.current()) setNotifications(answer);
    });
    return () => {
      reply.close();
    };
    // Also on the minute, because a refusal recorded while a panel is
    // already open would otherwise not show until it was closed and opened
    // again, and that is the panel a reader is on when they go looking.
  }, [activeSurface, clock, latestPermission]);
  return notifications;
}
