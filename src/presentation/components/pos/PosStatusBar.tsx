import React, {
  useEffect,
  useRef,
  useState
} from "react";

import {
  Calendar,
  Clock,
  RefreshCw,
  WifiOff,
  CheckCircle2
} from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { useAuth } from "../../context/AuthContext";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { useConnection } from "../../../core/store/useConnection";
import { usePendingSalesQueue } from "../../../core/offline/usePendingSalesQueue";

export function PosStatusBar() {

  const { user } = useAuth();
  const { t, language } = useTranslation();
  const { isOnline, checkNow, checking } = useConnection();
  const { count } = usePendingSalesQueue();

  const [now, setNow] = useState(new Date());

  // Muestra "todo sincronizado" un momento cuando la cola pasa de N>0 a 0.
  const [justSynced, setJustSynced] = useState(false);
  const prevCountRef = useRef(count);

  useEffect(() => {

    if (prevCountRef.current > 0 && count === 0) {
      setJustSynced(true);
      const timeout = setTimeout(() => setJustSynced(false), 4_000);
      prevCountRef.current = count;
      return () => clearTimeout(timeout);
    }

    prevCountRef.current = count;

  }, [count]);

  useEffect(() => {

    const interval = setInterval(() => setNow(new Date()), 30_000);

    return () => clearInterval(interval);

  }, []);

  const date = now.toLocaleDateString(language, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

  const time = now.toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit"
  });

  return (

    <div className="flex items-center justify-between bg-vimdy-background-secondary border border-vimdy-border rounded-vimdy-lg px-5 py-2.5 flex-shrink-0 text-vimdy-micro">

      <div className="flex items-center gap-5">

        <span className="flex items-center gap-2 text-vimdy-text-secondary">
          <Calendar size={14} />
          {date}
        </span>

        <span className="flex items-center gap-2 text-vimdy-text-secondary">
          <Clock size={14} />
          {time}
        </span>

      </div>

      <span className="text-vimdy-text-secondary">
        {t("pos.status.cashier")}: <span className="text-vimdy-text font-semibold">{user?.name ?? t("pos.status.administrator")}</span>
      </span>

      <div className="flex items-center gap-5">

        {!isOnline && (
          <>
            <span className="flex items-center gap-2 text-vimdy-danger">
              <WifiOff size={13} />
              {t("pos.status.offline")}
              {count > 0 && (
                <span className="text-vimdy-text-tertiary">
                  · {t("pos.status.pendingSales", { count })}
                </span>
              )}
            </span>

            <VimdyButton
              onClick={() => checkNow()}
              disabled={checking}
              variant="ghost"
              size="sm"
              icon={<RefreshCw size={12} className={checking ? "animate-vimdy-spin" : ""} />}
            >
              {t("pos.status.retry")}
            </VimdyButton>
          </>
        )}

        {isOnline && count > 0 && (
          <span className="flex items-center gap-2 text-vimdy-warning">
            <RefreshCw size={13} className="animate-vimdy-spin" />
            {t("pos.status.syncing", { count })}
          </span>
        )}

        {isOnline && count === 0 && justSynced && (
          <span className="flex items-center gap-2 text-vimdy-success">
            <CheckCircle2 size={13} />
            {t("pos.status.allSynced")}
          </span>
        )}

        {isOnline && count === 0 && !justSynced && (
          <>
            <span className="flex items-center gap-2 text-vimdy-success">
              <span className="w-1.5 h-1.5 rounded-full bg-vimdy-success" />
              {t("pos.status.connected")}
            </span>

            <span className="flex items-center gap-2 text-vimdy-accent">
              <RefreshCw size={13} />
              {t("pos.status.synced")}
            </span>
          </>
        )}

      </div>

    </div>

  );

}