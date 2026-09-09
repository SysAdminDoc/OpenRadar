import { useEffect, useState } from "react";
import {
  crashReportAvailable,
  lastCrash as lastCrashDump,
  lastWebviewReport,
  rememberWebviewVersion,
  webviewVersion,
  type CrashRecord,
} from "../lib/crashReport";
import { useLatestReply } from "./useLatestReply";

/**
 * What the machine has to say about the last run, for the report a reader
 * sends in.
 *
 * Asked once, at start-up, and on the same terms in every case: none of
 * these can change while this process is alive, because the only thing that
 * writes a crash record is this process dying and the runtime version is
 * fixed for the life of the window. So there is nothing to poll and nothing
 * to invalidate, and the whole of it is three questions and their answers.
 *
 * None of it leaves the machine. The report is written for the reader to
 * read and to paste somewhere if they choose to.
 */
export interface NativeReports {
  /** The dump this process's predecessor left, when it left one. */
  lastCrash: CrashRecord | null;
  /** The newest report the window itself left, on the same terms. */
  lastWebviewCrash: CrashRecord | null;
  /**
   * Which Chromium is drawing.
   *
   * Undefined until it has been asked, which the report writes as unknown.
   * Null means there is no native runtime, which is the browser preview, and
   * a native window that will not say its version rejects rather than
   * answering null: the two are different things and the report says which.
   */
  webviewRuntime: string | null | undefined;
}

export function useNativeReports(): NativeReports {
  const [lastCrash, setLastCrash] = useState<CrashRecord | null>(null);
  const [lastWebviewCrash, setLastWebviewCrash] = useState<CrashRecord | null>(
    null,
  );
  const [webviewRuntime, setWebviewRuntime] = useState<
    string | null | undefined
  >(undefined);

  // Asked in every runtime, unlike the two crash lookups: the browser preview
  // has an answer here and it is "there is no native runtime".
  const latestRuntime = useLatestReply();
  useEffect(() => {
    const reply = latestRuntime();
    void webviewVersion()
      .then((version) => {
        rememberWebviewVersion(version);
        if (reply.current()) setWebviewRuntime(version);
      })
      .catch(() => {
        // The runtime would not say. Left undefined, which the report writes
        // as unknown rather than as a failure a reader has to act on.
      });
    return () => {
      reply.close();
    };
  }, [latestRuntime]);

  const latestWebviewCrash = useLatestReply();
  useEffect(() => {
    if (!crashReportAvailable()) return;
    const reply = latestWebviewCrash();
    void lastWebviewReport()
      .then((found) => {
        if (reply.current()) setLastWebviewCrash(found);
      })
      .catch(() => {
        // No folder is the ordinary state: it exists once the runtime has had
        // something to report.
      });
    void lastCrashDump()
      .then((found) => {
        if (reply.current()) setLastCrash(found);
      })
      .catch(() => {
        // Nothing to say is the ordinary state, and a report that cannot be
        // read is not itself worth a line in the log.
      });
    return () => {
      reply.close();
    };
  }, [latestWebviewCrash]);

  return { lastCrash, lastWebviewCrash, webviewRuntime };
}
