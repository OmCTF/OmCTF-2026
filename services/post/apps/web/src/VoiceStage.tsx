import { useEffect, useRef, useState, type ReactNode } from "react";
import type { VoiceParticipant } from "../../../packages/contracts/generated/ts/models";
import { receiveSlot, type CallState, type MediaKind } from "./voice-client";
import { Icon } from "./Icons";
import { useRoute } from "./navigation";
import { ChatWindow } from "./ChatWindow";
import { useVoice } from "./VoicePanel";
import { BrandMark } from "./Brand";
import { VoiceDeviceChoice, voiceDeviceOptions } from "./VoiceDeviceChoice";
import { Soundboard, type SoundClip } from "./Soundboard";

function Media({
  track,
  kind,
  muted,
  sink,
  report,
}: {
  track: MediaStreamTrack;
  kind: string;
  muted: boolean;
  sink: string;
  report: (error: unknown) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const media = ref.current!;
    media.srcObject = new MediaStream([track]);
    void media
      .play()
      .catch(() => report(new Error("Нажмите на наушники, чтобы включить воспроизведение.")));
    return () => {
      media.srcObject = null;
    };
  }, [track]);
  useEffect(() => {
    const media = ref.current! as HTMLVideoElement & {
      setSinkId?: (id: string) => Promise<void>;
      sinkId?: string;
    };
    if (kind !== "audio" || (!sink && !media.sinkId)) return;
    if (media.setSinkId) void media.setSinkId(sink).catch(report);
    else if (sink) report(new Error("Выбор выхода не поддерживается этим браузером."));
  }, [sink, kind]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted || kind !== "audio"}
      className={kind === "audio" ? "voice-audio" : "voice-video"}
    />
  );
}

function VoiceTile({
  participant,
  audio,
  video,
  audioContext,
  local,
  kind = "camera",
  focused,
  onFocus,
  children,
  report,
}: {
  participant: VoiceParticipant;
  audio?: MediaStreamTrack;
  video?: MediaStreamTrack;
  audioContext: AudioContext | null;
  local: boolean;
  kind?: string;
  focused: boolean;
  onFocus: () => void;
  children?: ReactNode;
  report: (error: unknown) => void;
}) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    setSpeaking(false);
    if (!audio || !audioContext || audio.readyState !== "live") return;
    const source = audioContext.createMediaStreamSource(new MediaStream([audio]));
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let last = 0;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length);
      if (audio.enabled && rms > 0.015) last = performance.now();
      setSpeaking(audio.enabled && performance.now() - last < 220);
    }, 100);
    return () => {
      clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
    };
  }, [audio, audioContext]);
  return (
    <article
      className={`voice-tile ${speaking ? "is-speaking" : ""} ${focused ? "is-focused" : ""} ${video ? "has-video" : ""}`}
      data-participant-id={participant.id}
      aria-label={`${participant.display_name}${speaking ? ", говорит" : ""}`}
    >
      {video ? (
        <Media track={video} kind={kind} muted sink="" report={report} />
      ) : (
        <div className="voice-tile-avatar">
          {Array.from(participant.display_name)[0]?.toUpperCase()}
        </div>
      )}
      <div className="voice-tile-label">
        <span>
          {participant.display_name}
          {local ? " (вы)" : ""}
        </span>
        {kind === "screen" && <b>В ЭФИРЕ</b>}
        {!audio && (
          <span className="slashed">
            <Icon name="mic" size={16} />
          </span>
        )}
      </div>
      <button
        className="voice-tile-expand"
        aria-label={focused ? "Свернуть участника" : "Развернуть участника"}
        onClick={onFocus}
      >
        <Icon name="expand" size={18} />
      </button>
      {children}
    </article>
  );
}

export type VoiceStageProps = {
  state: CallState;
  busy: boolean;
  deaf: boolean;
  audioContext: AudioContext | null;
  devices: MediaDeviceInfo[];
  input: string;
  camera: string;
  sink: string;
  quality: string;
  setInput: (value: string) => void;
  setCamera: (value: string) => void;
  setSink: (value: string) => void;
  setQuality: (value: string) => void;
  capture: (kind: MediaKind, replace?: boolean, selected?: string) => Promise<void>;
  leave: () => Promise<void>;
  reconnect: () => Promise<void>;
  toggleDeaf: () => void;
  report: (error: unknown) => void;
  expanded: boolean;
  expand: () => void;
  collapse: () => void;
  chatOpen: boolean;
  chatAvailable: boolean;
  setChatOpen: (value: boolean) => void;
  onInvite?: () => void;
  sounds: SoundClip[];
  soundsLoading: boolean;
  soundBusy: boolean;
  canUploadSounds: boolean;
  soundVolume: number;
  setSoundVolume: (value: number) => void;
  nowPlaying: string;
  loadSounds: () => void;
  playSound: (clip: SoundClip) => void;
  uploadSound: (file: File, name: string, emoji: string) => Promise<void>;
};

function DeviceOptions({ p, kind }: { p: VoiceStageProps; kind: "audio" | "camera" | "all" }) {
  const root = useRef<HTMLDivElement>(null);
  const [openChoice, setOpenChoice] = useState<string | null>(null);
  useEffect(() => {
    const details = root.current?.closest("details");
    const toggle = () => {
      if (!details?.open) setOpenChoice(null);
    };
    details?.addEventListener("toggle", toggle);
    return () => details?.removeEventListener("toggle", toggle);
  }, []);
  const choiceState = (id: string) => ({
    open: openChoice === id,
    setOpen: (open: boolean) =>
      setOpenChoice((current) => (open ? id : current === id ? null : current)),
  });
  return (
    <div
      ref={root}
      className="voice-devices"
      role="menu"
      aria-label={
        kind === "audio" ? "Микрофон и звук" : kind === "camera" ? "Камера" : "Голос и видео"
      }
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          const details = event.currentTarget.closest("details");
          if (details) {
            details.open = false;
            details.querySelector("summary")?.focus();
          }
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const items = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              "[data-voice-device-trigger], .voice-menu-toggle, .voice-diagnostics > summary",
            ),
          ];
          const index = items.indexOf(document.activeElement as HTMLElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
          items[next]?.focus();
        }
      }}
    >
      <h3 className="id-sr">
        {kind === "audio" ? "Микрофон и звук" : kind === "camera" ? "Камера" : "Голос и видео"}
      </h3>
      {kind !== "camera" && (
        <>
          <VoiceDeviceChoice
            label="Устройство ввода"
            icon="mic"
            value={p.input}
            options={voiceDeviceOptions(p.devices, "audioinput", "Микрофон")}
            {...choiceState("input")}
            onChange={(value) => {
              p.setInput(value);
              if (p.state.local.audio) void p.capture("audio", true, value);
            }}
          />
          <VoiceDeviceChoice
            label="Устройство вывода"
            icon="headphones"
            value={p.sink}
            options={voiceDeviceOptions(p.devices, "audiooutput", "Выход")}
            {...choiceState("output")}
            onChange={p.setSink}
          />
          <button
            role="menuitemcheckbox"
            className="voice-menu-toggle"
            aria-checked={p.deaf}
            onClick={p.toggleDeaf}
          >
            Заглушить звук
            <span className={`voice-menu-checkbox ${p.deaf ? "is-checked" : ""}`}>
              {p.deaf && <Icon name="check" size={14} />}
            </span>
          </button>
        </>
      )}
      {kind !== "audio" && (
        <>
          <VoiceDeviceChoice
            label="Камера"
            icon="camera"
            value={p.camera}
            options={voiceDeviceOptions(p.devices, "videoinput", "Камера")}
            {...choiceState("camera")}
            onChange={(value) => {
              p.setCamera(value);
              if (p.state.local.camera) void p.capture("camera", true, value);
            }}
          />
          <VoiceDeviceChoice
            label="Качество видео"
            value={p.quality}
            options={[
              { value: "480", label: "480p · 600 Кбит/с" },
              { value: "720", label: "720p · 1,2 Мбит/с" },
            ]}
            {...choiceState("quality")}
            onChange={p.setQuality}
          />
        </>
      )}
      {kind === "all" && (
        <details className="voice-diagnostics">
          <summary>Качество соединения</summary>
          <p>
            {p.state.rtt === undefined
              ? "Ожидание измерения"
              : `${Math.round(p.state.rtt * 1000)} мс`}{" "}
            · Отправлено: {p.state.stats?.received_frames ?? 0} · Получено:{" "}
            {p.state.stats?.forwarded_frames ?? 0}
          </p>
        </details>
      )}
    </div>
  );
}

export function VoiceStage(p: VoiceStageProps) {
  const [focus, setFocus] = useState("");
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const route = useRoute();
  const active = p.expanded && route.room === p.state.channelID && route.tab === "guilds";
  const showControls = () => {
    clearTimeout(chromeTimer.current);
    setChromeVisible(true);
    chromeTimer.current = setTimeout(() => setChromeVisible(false), 2500);
  };
  const toggleSoundboard = () => {
    if (!soundboardOpen) p.loadSounds();
    setSoundboardOpen((value) => !value);
    showControls();
  };
  useEffect(() => {
    showControls();
    return () => clearTimeout(chromeTimer.current);
  }, [active]);
  useEffect(() => {
    setSoundboardOpen(false);
  }, [p.state.channelID, p.state.status]);
  useEffect(() => {
    if (!active) setSoundboardOpen(false);
  }, [active]);
  const connected = p.state.status === "connected";
  const own = p.state.room?.participants.find((v) => v.id === p.state.participantID);
  const remote = p.state.room
    ? [...p.state.tracks]
        .map(([mid, track]) => ({ mid, track, publication: receiveSlot(mid, p.state.room!) }))
        .filter((v) => v.publication)
    : [];
  const focused = p.state.room?.participants.some(
    (v) =>
      v.id === focus.replace(/:screen$/, "") &&
      (!focus.endsWith(":screen") ||
        (v.id === p.state.participantID
          ? p.state.local.screen
          : remote.some(
              (r) => r.publication?.participant_id === v.id && r.publication?.kind === "screen",
            ))),
  )
    ? focus
    : "";
  const status = connected
    ? "Голосовая связь подключена"
    : p.state.status === "connecting"
      ? "Подключение…"
      : "Связь прервана";
  return (
    <section
      className={`voice-panel ${active ? "is-stage" : "is-docked"} ${p.chatOpen ? "with-chat" : ""} ${chromeVisible || soundboardOpen ? "" : "controls-hidden"}`}
      aria-label="Текущий звонок"
      onPointerMove={showControls}
      onKeyDown={showControls}
    >
      <header className="voice-stage-header">
        <div>
          <Icon name="speaker" />
          <h2>{p.state.name}</h2>
        </div>
        <div>
          {active ? (
            <>
              {p.chatAvailable && (
                <button
                  aria-label={p.chatOpen ? "Закрыть чат звонка" : "Открыть чат звонка"}
                  data-tooltip="Чат"
                  onClick={() => p.setChatOpen(!p.chatOpen)}
                >
                  <Icon name="chat" />
                </button>
              )}
              <button aria-label="Свернуть звонок" data-tooltip="Свернуть" onClick={p.collapse}>
                <Icon name="down" />
              </button>
            </>
          ) : (
            <button className="voice-open-call" aria-label="Развернуть звонок" onClick={p.expand}>
              <span className="connection-bars">
                <i />
                <i />
                <i />
              </span>
              <span>
                <strong>{status}</strong>
                <small>{p.state.name}</small>
              </span>
            </button>
          )}
          {!active && (
            <button
              aria-label="Выйти из звонка"
              className="voice-dock-leave"
              data-tooltip="Отключиться"
              onClick={() => void p.leave()}
            >
              <Icon name="phone" />
            </button>
          )}
        </div>
      </header>
      {p.state.error && (
        <p className="voice-error" role="alert">
          {p.state.error}
        </p>
      )}
      {p.state.status === "disconnected" && (
        <button className="voice-reconnect" disabled={p.busy} onClick={() => void p.reconnect()}>
          Подключиться заново
        </button>
      )}
      <div className={`voice-grid ${focused ? "has-focus" : ""}`} aria-label="Участники звонка">
        {p.state.room?.participants.map((participant) => {
          const local = participant.id === p.state.participantID;
          const audio = local
            ? p.state.local.audio
            : remote.find(
                (v) =>
                  v.publication?.participant_id === participant.id &&
                  v.publication?.kind === "audio",
              )?.track;
          const camera = local
            ? p.state.local.camera
            : remote.find(
                (v) =>
                  v.publication?.participant_id === participant.id &&
                  v.publication?.kind === "camera",
              )?.track;
          const screen = local
            ? p.state.local.screen
            : remote.find(
                (v) =>
                  v.publication?.participant_id === participant.id &&
                  v.publication?.kind === "screen",
              )?.track;
          return (
            <div key={participant.id} className="voice-participant-tiles">
              <VoiceTile
                participant={participant}
                audio={audio}
                video={camera}
                local={local}
                audioContext={p.audioContext}
                focused={focus === participant.id}
                onFocus={() => setFocus(focus === participant.id ? "" : participant.id)}
                report={p.report}
              />
              {screen && (
                <VoiceTile
                  participant={participant}
                  video={screen}
                  kind="screen"
                  local={local}
                  audioContext={p.audioContext}
                  focused={focus === `${participant.id}:screen`}
                  onFocus={() =>
                    setFocus(focus === `${participant.id}:screen` ? "" : `${participant.id}:screen`)
                  }
                  report={p.report}
                />
              )}
            </div>
          );
        })}
        {p.onInvite &&
          p.state.room?.participants.length === 1 &&
          !focused &&
          !p.state.local.screen &&
          !remote.some((v) => v.publication?.kind === "screen") && (
            <article className="voice-invite-tile">
              <div className="voice-invite-art">
                <BrandMark size={104} />
              </div>
              <button onClick={p.onInvite}>
                <Icon name="request" size={20} />
                Пригласить в голосовой чат
              </button>
            </article>
          )}
        {!p.state.room && (
          <div className="voice-connecting" role="status">
            {p.state.status === "connecting" && <span className="voice-connect-spinner" />}
            {status}
          </div>
        )}
      </div>
      <div className="voice-remote-audio" aria-hidden="true">
        {remote
          .filter((v) => v.publication?.kind === "audio")
          .map((v) => (
            <Media
              key={`${v.publication!.id}-${v.mid}`}
              track={v.track}
              kind="audio"
              muted={p.deaf}
              sink={p.sink}
              report={p.report}
            />
          ))}
      </div>
      <div className="voice-controls">
        <div className="voice-control-group">
          <div className={`voice-split-control ${!p.state.local.audio ? "is-muted" : ""}`}>
            <button
              className={!p.state.local.audio ? "control-off" : ""}
              disabled={!connected || p.busy || !own?.can_speak}
              aria-label={p.state.local.audio ? "Выключить микрофон" : "Включить микрофон"}
              data-tooltip={p.state.local.audio ? "Выключить микрофон" : "Включить микрофон"}
              aria-pressed={!!p.state.local.audio}
              onClick={() => void p.capture("audio")}
            >
              <span className={!p.state.local.audio ? "slashed" : ""}>
                <Icon name="mic" size={24} />
              </span>
            </button>
            <details className="voice-device-menu voice-input-menu" name="voice-device-menu">
              <summary aria-label="Настройки микрофона" data-tooltip="Настройки микрофона">
                <Icon name="down" size={16} />
              </summary>
              <DeviceOptions p={p} kind="audio" />
            </details>
          </div>
          <div className="voice-split-control">
            <button
              disabled={!connected || p.busy || !own?.can_stream}
              className={p.state.local.camera ? "control-on" : ""}
              aria-label={p.state.local.camera ? "Выключить камеру" : "Включить камеру"}
              data-tooltip="Камера"
              aria-pressed={!!p.state.local.camera}
              onClick={() => void p.capture("camera")}
            >
              <Icon name="camera" size={24} />
            </button>
            <details className="voice-device-menu voice-camera-menu" name="voice-device-menu">
              <summary aria-label="Настройки камеры" data-tooltip="Настройки камеры">
                <Icon name="down" size={16} />
              </summary>
              <DeviceOptions p={p} kind="camera" />
            </details>
          </div>
        </div>
        <div className="voice-control-group">
          <button
            disabled={!connected || p.busy || !own?.can_stream}
            className={p.state.local.screen ? "control-on" : ""}
            aria-label={p.state.local.screen ? "Остановить экран" : "Показать экран"}
            data-tooltip="Демонстрация экрана"
            aria-pressed={!!p.state.local.screen}
            onClick={() => void p.capture("screen")}
          >
            <Icon name="screen" size={24} />
          </button>
          <button
            disabled={!connected}
            className={`voice-deaf-control ${p.deaf ? "control-off" : ""}`}
            aria-label={p.deaf ? "Включить звук" : "Заглушить звук"}
            data-tooltip="Звук"
            aria-pressed={p.deaf}
            onClick={p.toggleDeaf}
          >
            <span className={p.deaf ? "slashed" : ""}>
              <Icon name="headphones" size={24} />
            </span>
          </button>
          <button
            disabled={!connected}
            className="voice-soundboard-trigger"
            aria-label="Открыть звуковую панель"
            data-tooltip="Звуковая панель"
            aria-expanded={soundboardOpen}
            onClick={toggleSoundboard}
          >
            <Icon name="soundboard" size={24} />
          </button>
          <details className="voice-device-menu" name="voice-device-menu">
            <summary aria-label="Устройства и качество" data-tooltip="Устройства и качество">
              <Icon name="more" size={24} />
            </summary>
            <DeviceOptions p={p} kind="all" />
          </details>
        </div>
        <button
          className="voice-hangup"
          aria-label="Выйти из звонка"
          data-tooltip="Отключиться"
          onClick={() => void p.leave()}
        >
          <Icon name="phone" size={24} />
        </button>
      </div>
      <Soundboard
        clips={p.sounds}
        channelID={p.state.channelID}
        open={soundboardOpen && active && connected}
        loading={p.soundsLoading}
        busy={p.soundBusy}
        canUpload={p.canUploadSounds}
        volume={p.soundVolume}
        onVolume={p.setSoundVolume}
        onClose={() => setSoundboardOpen(false)}
        onPlay={p.playSound}
        onUpload={p.uploadSound}
      />
      {p.nowPlaying && !p.deaf && (
        <div className="voice-soundboard-now" role="status">
          {p.nowPlaying}
        </div>
      )}
      {active && (
        <div className="voice-stage-status" role="status">
          <span className={connected ? "online-dot" : "offline-dot"} />
          {status}
          {own && !own.can_speak && " · Микрофон недоступен по правам канала"}
        </div>
      )}
    </section>
  );
}

export function VoiceRoom({
  id,
  name,
  canJoin,
  canRead,
  userID,
  avatars,
  onInvite,
}: {
  id: string;
  name: string;
  canJoin: boolean;
  canRead: boolean;
  userID: string;
  avatars: Record<string, string>;
  onInvite?: () => void;
}) {
  const call = useVoice();
  const invite = useRef(onInvite);
  const chatToggle = useRef<HTMLButtonElement>(null);
  invite.current = onInvite;
  const canInvite = !!onInvite;
  useEffect(() => {
    call.setChatAvailable(canRead);
    if (!canRead) call.setChatOpen(false);
    return () => call.setChatAvailable(false);
  }, [canRead]);
  useEffect(() => {
    call.setInviteHandler(canInvite ? () => invite.current?.() : undefined);
    return () => call.setInviteHandler(undefined);
  }, [canInvite, id]);
  const connected = call.state?.channelID === id && call.state.status !== "disconnected";
  return (
    <div className={`voice-room ${call.chatOpen && canRead ? "has-chat" : ""}`}>
      <section className="voice-lobby">
        <header>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M12 3a1 1 0 0 0-1-1h-.06a1 1 0 0 0-.74.32L5.92 7H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.92l4.28 4.68a1 1 0 0 0 .74.32H11a1 1 0 0 0 1-1V3ZM15.1 20.75c-.58.14-1.1-.33-1.1-.92v-.03c0-.5.37-.92.85-1.05a7 7 0 0 0 0-13.5A1.11 1.11 0 0 1 14 4.2v-.03c0-.6.52-1.06 1.1-.92a9 9 0 0 1 0 17.5Z" />
          </svg>
          <h2>{name}</h2>
          {canRead && (
            <button
              ref={chatToggle}
              aria-label={call.chatOpen ? "Закрыть чат звонка" : "Открыть чат звонка"}
              onClick={() => call.setChatOpen(!call.chatOpen)}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M12 22a10 10 0 1 0-8.45-4.64c.13.19.11.44-.04.61l-2.06 2.37A1 1 0 0 0 2.2 22H12Z" />
              </svg>
            </button>
          )}
        </header>
        <div className="voice-lobby-center">
          <h2>{name}</h2>
          <p>Голосовой канал</p>
          {canJoin ? (
            <>
              <button
                className="voice-join"
                onClick={() => (connected ? call.expand() : void call.join(id, name))}
              >
                {connected ? "Вернуться к звонку" : "Присоединиться к голосовому каналу"}
              </button>
              {!connected && (
                <button
                  className="voice-join-listen"
                  onClick={() => void call.join(id, name, true)}
                >
                  Войти без микрофона
                </button>
              )}
            </>
          ) : (
            <p>У вас нет прав подключаться к этому каналу</p>
          )}
        </div>
      </section>
      {call.chatOpen && canRead && (
        <aside className="voice-channel-chat">
          <button
            className="voice-close-chat"
            aria-label="Закрыть чат звонка"
            onClick={() => {
              call.setChatOpen(false);
              requestAnimationFrame(() => chatToggle.current?.focus({ preventScroll: true }));
            }}
          >
            <Icon name="close" />
          </button>
          <ChatWindow
            roomID={id}
            roomKind="channel"
            userID={userID}
            title={name}
            avatars={avatars}
            presentation="voice"
          />
        </aside>
      )}
    </div>
  );
}
