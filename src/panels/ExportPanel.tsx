import {
  Camera,
  Film,
  Image,
  ImageDown,
  LoaderCircle,
  Table2,
} from "lucide-react";
import { useState } from "react";
import { PanelShell } from "../components/PanelShell";
import { useT } from "../i18n";
import { MAX_GIF_FRAMES } from "../lib/export";
import {
  MAX_CAPTION,
  POSTCARD_SIZES,
  type PostcardSize,
} from "../lib/postcard";

/** One dataset on screen that can be written as numbers. */
export interface DataExportOffer {
  /** Stable across renders, so the busy state can name which one is running. */
  id: string;
  label: string;
  /** `csv` or `tif`, said plainly beside the button. */
  format: string;
  run: () => void;
}

interface ExportPanelProps {
  frameCount: number;
  busy: string | null;
  progress: { done: number; total: number } | null;
  onExportImage: () => void;
  /** The same frame as a card to send somebody, beside the plain picture. */
  onExportPostcard: (options: {
    size: PostcardSize;
    written: string;
    place: string;
  }) => void;
  /** The reader's own word for where they live, when they have one. */
  placeName: string;
  onExportLoop: () => void;
  onExportGif: () => void;
  /** The readings behind the picture, one entry per dataset drawn. */
  dataExports: DataExportOffer[];
  onClose: () => void;
}

export function ExportPanel({
  frameCount,
  busy,
  progress,
  onExportImage,
  onExportPostcard,
  placeName,
  onExportLoop,
  onExportGif,
  dataExports,
  onClose,
}: ExportPanelProps) {
  const [written, setWritten] = useState("");
  const [withPlace, setWithPlace] = useState(false);
  const [size, setSize] = useState<PostcardSize>(POSTCARD_SIZES[0]);
  const t = useT();

  return (
    <PanelShell
      eyebrow={t("export.eyebrow")}
      title={t("export.title")}
      onClose={onClose}
      className="surface-panel--right"
    >
      <button
        type="button"
        className="secondary-button"
        disabled={Boolean(busy)}
        onClick={onExportImage}
      >
        {busy === "image" ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Camera size={16} />
        )}
        {t("export.image")}
      </button>

      <button
        type="button"
        className="secondary-button"
        disabled={Boolean(busy) || frameCount < 2}
        onClick={onExportLoop}
      >
        {busy === "loop" ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Film size={16} />
        )}
        {t("export.loop")}
        {frameCount > 1 ? t("export.loopFrames", { count: frameCount }) : ""}
      </button>

      <button
        type="button"
        className="secondary-button"
        disabled={Boolean(busy) || frameCount < 2}
        onClick={onExportGif}
      >
        {busy === "gif" ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Image size={16} />
        )}
        {t("export.gif")}
        {frameCount > 1
          ? t("export.gifFrames", {
              count: Math.min(frameCount, MAX_GIF_FRAMES),
            })
          : ""}
      </button>

      <div className="settings-section" data-postcard>
        <div className="settings-section__title">
          <span>{t("postcard.title")}</span>
        </div>
        <p className="source-note">{t("postcard.note")}</p>
        {/* The line the picture carries, shown here as well, so what the
            card says about itself is not a promise made out of sight. */}
        <p className="source-note" data-postcard-disclaimer>
          {t("postcard.notOfficial")}
        </p>
        <label className="settings-field">
          <span>{t("postcard.caption")}</span>
          <input
            type="text"
            value={written}
            maxLength={MAX_CAPTION}
            placeholder={t("postcard.captionPlaceholder")}
            onChange={(event) => setWritten(event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>{t("postcard.sizeLabel")}</span>
          <select
            value={size.id}
            onChange={(event) =>
              setSize(
                POSTCARD_SIZES.find((one) => one.id === event.target.value) ??
                  POSTCARD_SIZES[0],
              )
            }
          >
            {POSTCARD_SIZES.map((one) => (
              <option key={one.id} value={one.id}>
                {t(`postcard.size.${one.id}`)}
              </option>
            ))}
          </select>
        </label>
        {placeName ? (
          <label className="toggle-row toggle-row--plain">
            <span>
              <strong>{t("postcard.includePlace")}</strong>
            </span>
            <input
              type="checkbox"
              checked={withPlace}
              onChange={(event) => setWithPlace(event.target.checked)}
            />
            <i className="toggle-track" aria-hidden="true" />
          </label>
        ) : null}
        <button
          type="button"
          className="secondary-button"
          disabled={busy !== null}
          onClick={() =>
            onExportPostcard({
              size,
              written,
              // Off unless the reader said so: where somebody lives is not
              // something a picture they are about to send needs to say.
              place: withPlace ? placeName : "",
            })
          }
        >
          <ImageDown size={16} /> {t("postcard.save")}
        </button>
      </div>

      {dataExports.length ? (
        <div className="settings-section" data-data-exports>
          <div className="settings-section__title">
            <span>{t("export.dataHeading")}</span>
          </div>
          <p className="source-note">{t("export.dataNote")}</p>
          {dataExports.map((offer) => (
            <button
              key={offer.id}
              type="button"
              className="secondary-button"
              disabled={Boolean(busy)}
              onClick={offer.run}
              data-data-export={offer.id}
            >
              {busy === `data:${offer.id}` ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Table2 size={16} />
              )}
              {t("export.dataFile", {
                label: offer.label,
                format: offer.format,
              })}
            </button>
          ))}
        </div>
      ) : null}

      {/* Mounted before there is anything to say, for the same reason the
          tool readout is: a live region that arrives carrying its first value
          often does not announce it, and the first frame of a recording is
          the one somebody is waiting to hear about. */}
      <p
        className="source-note"
        role="status"
        data-empty={progress ? undefined : "1"}
      >
        {progress
          ? t("export.recording", {
              done: progress.done,
              total: progress.total,
            })
          : ""}
      </p>

      <div className="feature-card">
        <Film size={24} />
        <div>
          <strong>{t("export.cardTitle")}</strong>
          <span>{t("export.cardBody")}</span>
        </div>
      </div>

      <p className="source-note">{t("export.note")}</p>
    </PanelShell>
  );
}
