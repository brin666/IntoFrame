import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Player, type ErrorFallback, type PlayerRef } from "@remotion/player";
import {
  PhotoReveal,
  PhotoRevealErrorContext,
  type PhotoRevealProps,
} from "./remotion/PhotoReveal";
import {
  PHOTO_REVEAL_DURATION,
  PHOTO_REVEAL_FPS,
} from "./remotion/revealTimeline";

export interface PhotoRevealPlayerProps {
  input: PhotoRevealProps;
  playing: boolean;
  onComplete: () => void;
  onUnavailable: (message: string) => void;
}

type AssetState = "loading" | "ready" | "ended" | "failed";

const posterStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  display: "block",
  objectFit: "fill",
  pointerEvents: "none",
};

function OriginalPoster({ sourceUrl }: { sourceUrl: string }) {
  return (
    <img
      src={sourceUrl}
      alt=""
      draggable={false}
      style={posterStyle}
      data-reveal-poster="original"
    />
  );
}

function FailurePoster({
  sourceUrl,
  reportFailure,
}: {
  sourceUrl: string;
  reportFailure: (message: string) => void;
}) {
  // errorFallback runs during render. Notify the host only after commit.
  useEffect(() => {
    reportFailure("过渡播放不可用，已恢复预览。");
  }, [reportFailure]);
  return <OriginalPoster sourceUrl={sourceUrl} />;
}

function validInput(input: PhotoRevealProps): boolean {
  return (
    [input.sourceUrl, input.backgroundUrl, input.subjectUrl].every(
      (url) => typeof url === "string" && url.trim().length > 0,
    ) &&
    Number.isSafeInteger(input.width) &&
    input.width > 0 &&
    Number.isSafeInteger(input.height) &&
    input.height > 0 &&
    Number.isFinite(input.zoom) &&
    input.zoom > 0 &&
    Number.isFinite(input.shiftX) &&
    Number.isFinite(input.shiftY)
  );
}

function decodeNativeImage(
  url: string,
  input: PhotoRevealProps,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
      window.clearTimeout(timeout);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => {
      fail(new DOMException("Reveal asset load cancelled.", "AbortError"));
      image.removeAttribute("src");
    };
    const timeout = window.setTimeout(
      () => fail(new Error("过渡图片加载超时，已恢复预览。")),
      20_000,
    );
    signal.addEventListener("abort", abort, { once: true });
    image.onerror = () => fail(new Error("过渡图片加载失败，已恢复预览。"));
    image.onload = async () => {
      try {
        await image.decode();
        if (settled || signal.aborted) return;
        if (
          image.naturalWidth !== input.width ||
          image.naturalHeight !== input.height
        ) {
          fail(new Error("过渡图层尺寸不一致，已恢复预览。"));
          return;
        }
        settled = true;
        cleanup();
        resolve(image);
      } catch {
        fail(new Error("过渡图片解码失败，已恢复预览。"));
      }
    };
    if (signal.aborted) abort();
    else image.src = url;
  });
}

function RevealSession({
  input,
  playing,
  onComplete,
  onUnavailable,
}: PhotoRevealPlayerProps) {
  const playerRef = useRef<PlayerRef>(null);
  const activeRef = useRef(true);
  const failedRef = useRef(false);
  const completedRef = useRef(false);
  const decodedImagesRef = useRef<HTMLImageElement[]>([]);
  const callbacksRef = useRef({ onComplete, onUnavailable });
  callbacksRef.current = { onComplete, onUnavailable };
  const [assets, setAssets] = useState<AssetState>("loading");
  const [visible, setVisible] = useState(
    () => document.visibilityState !== "hidden",
  );
  const snapshot = useMemo(
    () => ({ ...input }),
    [
      input.sourceUrl,
      input.backgroundUrl,
      input.subjectUrl,
      input.width,
      input.height,
      input.zoom,
      input.shiftX,
      input.shiftY,
    ],
  );

  const reportFailure = useCallback((message: string) => {
    if (!activeRef.current || failedRef.current || completedRef.current) return;
    failedRef.current = true;
    playerRef.current?.pause();
    setAssets("failed");
    callbacksRef.current.onUnavailable(message);
  }, []);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    const updateVisibility = () => {
      const nextVisible = document.visibilityState !== "hidden";
      if (!nextVisible) playerRef.current?.pause();
      setVisible(nextVisible);
    };
    document.addEventListener("visibilitychange", updateVisibility);
    return () =>
      document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    if (!validInput(snapshot)) {
      reportFailure("过渡参数不完整，已恢复预览。");
      return () => controller.abort();
    }
    Promise.all([
      decodeNativeImage(snapshot.sourceUrl, snapshot, controller.signal),
      decodeNativeImage(snapshot.backgroundUrl, snapshot, controller.signal),
      decodeNativeImage(snapshot.subjectUrl, snapshot, controller.signal),
    ])
      .then((images) => {
        if (cancelled || !activeRef.current || failedRef.current) return;
        // Retain decoded native images while the Player uses the same URLs.
        decodedImagesRef.current = images;
        setAssets("ready");
      })
      .catch((error: unknown) => {
        if (cancelled || !activeRef.current) return;
        controller.abort();
        reportFailure(
          error instanceof Error
            ? error.message
            : "过渡图片不可用，已恢复预览。",
        );
      });
    return () => {
      cancelled = true;
      controller.abort();
      decodedImagesRef.current = [];
    };
  }, [snapshot, reportFailure]);

  const hasPlayer = assets === "ready" || assets === "ended";
  useEffect(() => {
    const player = playerRef.current;
    if (!hasPlayer || !player) return;
    const ended = () => {
      if (!activeRef.current || failedRef.current || completedRef.current)
        return;
      completedRef.current = true;
      setAssets("ended");
      callbacksRef.current.onComplete();
    };
    player.addEventListener("ended", ended);
    return () => player.removeEventListener("ended", ended);
  }, [hasPlayer]);

  useEffect(() => {
    const player = playerRef.current;
    if (!hasPlayer || !player) return;
    if (playing && visible && !failedRef.current && !completedRef.current)
      player.play();
    else player.pause();
  }, [hasPlayer, playing, visible]);

  const errorFallback = useCallback<ErrorFallback>(
    () => (
      <FailurePoster
        sourceUrl={snapshot.sourceUrl}
        reportFailure={reportFailure}
      />
    ),
    [snapshot.sourceUrl, reportFailure],
  );

  return (
    <div
      className="photo-reveal-player photo-reveal-overlay"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        backgroundColor: "#0b0c0d",
      }}
      data-photo-reveal="player"
      data-reveal-state={
        assets === "ready"
          ? playing && visible
            ? "playing"
            : "paused"
          : assets
      }
      data-reveal-assets={
        assets === "ready" || assets === "ended" ? "ready" : assets
      }
      data-reveal-source={snapshot.sourceUrl}
      data-reveal-background={snapshot.backgroundUrl}
      data-reveal-subject={snapshot.subjectUrl}
      data-reveal-width={snapshot.width}
      data-reveal-height={snapshot.height}
    >
      {hasPlayer ? (
        <PhotoRevealErrorContext.Provider value={reportFailure}>
          <Player
            ref={playerRef}
            component={PhotoReveal}
            inputProps={snapshot}
            compositionWidth={snapshot.width}
            compositionHeight={snapshot.height}
            fps={PHOTO_REVEAL_FPS}
            durationInFrames={PHOTO_REVEAL_DURATION}
            style={{ width: "100%", height: "100%" }}
            controls={false}
            autoPlay={playing && visible}
            loop={false}
            moveToBeginningWhenEnded={false}
            initiallyMuted
            initialVolume={0}
            numberOfSharedAudioTags={0}
            clickToPlay={false}
            doubleClickToFullscreen={false}
            spaceKeyToPlayOrPause={false}
            allowFullscreen={false}
            errorFallback={errorFallback}
          />
        </PhotoRevealErrorContext.Provider>
      ) : (
        <OriginalPoster sourceUrl={snapshot.sourceUrl} />
      )}
    </div>
  );
}

/** A changed set of native assets or crop starts a fresh, cancellable session. */
export function PhotoRevealPlayer(props: PhotoRevealPlayerProps) {
  const input = props.input;
  const key = JSON.stringify([
    input.sourceUrl,
    input.backgroundUrl,
    input.subjectUrl,
    input.width,
    input.height,
    input.zoom,
    input.shiftX,
    input.shiftY,
  ]);
  return <RevealSession key={key} {...props} />;
}
