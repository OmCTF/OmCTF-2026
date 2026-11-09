import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { VoiceConnection, voiceError, type CallState, type MediaKind } from "./voice-client";
import { VoiceStage } from "./VoiceStage";
import type { SoundClip } from "./Soundboard";
import type { GuildInfo } from "../../../packages/contracts/generated/ts/models";
import { navigate, useRoute } from "./navigation";
import { api } from "./identity-api";
import { requestID } from "./request-id";
import "./voice.css";

type VoiceContextValue = {
  state: CallState | null;
  join: (id: string, name: string, listenOnly?: boolean) => Promise<void>;
  leave: () => Promise<void>;
  muted: boolean;
  deaf: boolean;
  busy: boolean;
  toggleMic: () => void;
  toggleDeaf: () => void;
  expand: () => void;
  chatOpen: boolean;
  setChatOpen: (value: boolean) => void;
  setChatAvailable: (value: boolean) => void;
  setInviteHandler: (handler?: () => void) => void;
};
const VoiceContext = createContext<VoiceContextValue | null>(null);
export const useVoice = () => useContext(VoiceContext)!;

function playVoiceCue(context: AudioContext | null, kind: "join" | "leave" | "lost") {
  if (!context) return;
  const play = () => {
    if (context.state !== "running") return;
    const notes = kind === "join" ? [560, 740] : kind === "leave" ? [740, 500] : [420, 280];
    notes.forEach((frequency, index) => {
      const start = context.currentTime + index * 0.11;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.035, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.11);
    });
  };
  if (context.state === "running") play();
  else void context.resume().then(play).catch(() => {});
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CallState | null>(null);
  const current = useRef<VoiceConnection | null>(null);
  const captureInFlight = useRef<VoiceConnection | null>(null);
  const device = useRef(requestID());
  const audioWanted = useRef(true);
  const generation = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stableTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectAttempts = useRef(0);
  const closing = useRef<Promise<void>>(Promise.resolve());
  const audioContext = useRef<AudioContext | null>(null);
  const guild = useRef<string | undefined>(undefined);
  const route = useRoute();
  const [busy, setBusy] = useState(false);
  const [deaf, setDeaf] = useState(false);
  const [muteOnJoin, setMuteOnJoin] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [input, setInput] = useState("");
  const [camera, setCamera] = useState("");
  const [sink, setSink] = useState("");
  const [quality, setQuality] = useState("480");
  const [expanded, setExpanded] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatAvailable, setChatAvailable] = useState(false);
  const inviteHandler = useRef<(() => void) | undefined>(undefined);
  const [inviteAvailable, setInviteAvailable] = useState(false);
  const [sounds, setSounds] = useState<SoundClip[]>([]);
  const [soundsLoading, setSoundsLoading] = useState(false);
  const soundLoadGeneration = useRef(0);
  const [canUploadSounds, setCanUploadSounds] = useState(false);
  const [soundBusy, setSoundBusy] = useState(false);
  const [soundVolume, setSoundVolume] = useState(80);
  const [nowPlaying, setNowPlaying] = useState("");
  const soundAudio = useRef(new Set<HTMLAudioElement>());
  const soundTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const volumeRef = useRef(soundVolume);
  const deafRef = useRef(deaf);
  volumeRef.current = soundVolume;
  deafRef.current = deaf;
  useEffect(() => {
    for (const audio of soundAudio.current) audio.volume = soundVolume / 100;
  }, [soundVolume]);
  const report = (error: unknown) => current.current?.notice(voiceError(error));
  function stopSounds() {
    clearTimeout(soundTimer.current);
    for (const audio of soundAudio.current) {
      audio.pause();
      audio.src = "";
    }
    soundAudio.current.clear();
    setNowPlaying("");
  }
  async function loadSounds(channelID: string) {
    const load = ++soundLoadGeneration.current;
    setSoundsLoading(true);
    try {
      const response = await api<{
        can_upload: boolean;
        items: Array<{
          id: string;
          name: string;
          emoji: string;
          slot: number;
          duration_ms: number;
          content_type: string;
          builtin?: boolean;
        }>;
      }>(`/channels/${channelID}/sounds`);
      if (load === soundLoadGeneration.current && current.current?.state.channelID === channelID)
        setSounds(
          response.items.map((item) => ({
            id: item.id,
            name: item.name,
            emoji: item.emoji,
            channel_id: channelID,
            channel_name: item.builtin
              ? "Готовые звуки"
              : (current.current?.state.name ?? "Голосовой канал"),
            builtin: !!item.builtin,
          })),
        );
      if (load === soundLoadGeneration.current && current.current?.state.channelID === channelID)
        setCanUploadSounds(response.can_upload);
    } catch (error) {
      if (load === soundLoadGeneration.current) report(error);
    } finally {
      if (load === soundLoadGeneration.current) setSoundsLoading(false);
    }
  }
  async function uploadSound(file: File, name: string, emoji: string) {
    const channelID = current.current?.state.channelID;
    if (!channelID) throw Error("Сначала войдите в звонок.");
    if (file.size < 1 || file.size > 2 * 1024 * 1024) throw Error("Звук должен быть не больше 2 МиБ.");
    setSoundBusy(true);
    try {
      const guildID = current.current?.state.room?.guild_id;
      if (!guildID) throw Error("Нет данных голосового канала.");
      const guild = await api<GuildInfo>(`/guilds/${guildID}`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      await api(
        `/channels/${channelID}/sounds`,
        "POST",
        { name, emoji, audio_base64: btoa(binary) },
        { "If-Match": `"${guild.revision}"` },
      );
      await loadSounds(channelID);
    } finally {
      setSoundBusy(false);
    }
  }
  function playSound(clip: SoundClip) {
    void current.current?.playSound(clip.id).catch(report);
  }
  useEffect(() => {
    const update = () => {
      void navigator.mediaDevices
        ?.enumerateDevices()
        .then(setDevices)
        .catch(() => {});
    };
    update();
    navigator.mediaDevices?.addEventListener("devicechange", update);
    return () => {
      generation.current++;
      clearTimeout(reconnectTimer.current);
      clearTimeout(stableTimer.current);
      current.current?.dispose();
      stopSounds();
      void audioContext.current?.close().catch(() => {});
      navigator.mediaDevices?.removeEventListener("devicechange", update);
    };
  }, []);
  async function leave() {
    generation.current++;
    soundLoadGeneration.current++;
    clearTimeout(reconnectTimer.current);
    clearTimeout(stableTimer.current);
    reconnectAttempts.current = 0;
    const previous = current.current;
    if (previous?.state.status === "connected" && !deafRef.current)
      playVoiceCue(audioContext.current, "leave");
    current.current = null;
    closing.current = previous?.leave() ?? closing.current;
    setState(null);
    setSounds([]);
    setSoundsLoading(false);
    setCanUploadSounds(false);
    stopSounds();
    setBusy(false);
    await closing.current;
  }
  async function join(id: string, name: string, listenOnly = false, restoreAudio?: boolean, automatic = false) {
    clearTimeout(reconnectTimer.current);
    clearTimeout(stableTimer.current);
    if (!automatic) reconnectAttempts.current = 0;
    const publishAudio = restoreAudio ?? (!listenOnly && !muteOnJoin);
    audioWanted.current = publishAudio;
    setExpanded(true);
    guild.current = route.guild ?? guild.current;
    try {
      if (!audioContext.current || audioContext.current.state === "closed")
        audioContext.current = new AudioContext();
      void audioContext.current.resume().catch(() => {});
    } catch {
    }
    const attempt = ++generation.current;
    setBusy(true);
    const previous = current.current;
    current.current = null;
    soundLoadGeneration.current++;
    setSounds([]);
    setSoundsLoading(false);
    setCanUploadSounds(false);
    stopSounds();
    await closing.current;
    await previous?.leave();
    if (attempt !== generation.current) return;
    let lastSnapshot: CallState | null = null;
    const call = new VoiceConnection(
      id,
      name,
      (next) => {
        if (current.current !== call) return;
        if (!deafRef.current) {
          if (next.status === "connected" && lastSnapshot?.status !== "connected")
            playVoiceCue(audioContext.current, "join");
          if (lastSnapshot?.room && next.room && next.status === "connected") {
            const previousPeers = new Set(lastSnapshot.room.participants.map((p) => p.id));
            const currentPeers = new Set(next.room.participants.map((p) => p.id));
            if (next.room.participants.some((p) => p.id !== next.participantID && !previousPeers.has(p.id)))
              playVoiceCue(audioContext.current, "join");
            else if (lastSnapshot.room.participants.some((p) => p.id !== next.participantID && !currentPeers.has(p.id)))
              playVoiceCue(audioContext.current, "leave");
          }
          if (next.status === "disconnected" && lastSnapshot?.status !== "disconnected")
            playVoiceCue(audioContext.current, "lost");
        }
        if (next.status === "connected" && lastSnapshot?.status !== "connected") {
          stableTimer.current = setTimeout(() => { reconnectAttempts.current = 0; }, 30000);
        }
        if (next.status === "disconnected" && lastSnapshot?.status !== "disconnected") {
          clearTimeout(stableTimer.current);
          if (reconnectAttempts.current < 3 && !/отозван|сессия истекла|нет прав/i.test(next.error)) {
            const delay = 2000 * 2 ** reconnectAttempts.current++;
            reconnectTimer.current = setTimeout(() => {
              if (current.current === call) void join(id, name, listenOnly, audioWanted.current, true);
            }, delay);
          }
        }
        lastSnapshot = next;
        setState(next);
      },
      (event) => {
        if (current.current !== call || deafRef.current) return;
        const audio = new Audio(event.audio_url);
        audio.volume = volumeRef.current / 100;
        soundAudio.current.add(audio);
        audio.onended = () => soundAudio.current.delete(audio);
        audio.onerror = () => {
          soundAudio.current.delete(audio);
          if (current.current === call) call.notice("Не удалось загрузить звук.");
        };
        setNowPlaying(`${event.emoji} ${event.name}`);
        void audio.play().catch((error) => {
          soundAudio.current.delete(audio);
          if (current.current === call) call.notice(
            error instanceof DOMException && error.name === "NotAllowedError"
              ? "Нажмите на наушники, чтобы разрешить воспроизведение звука."
              : "Не удалось воспроизвести звук.",
          );
        });
        clearTimeout(soundTimer.current);
        soundTimer.current = setTimeout(() => setNowPlaying(""), 4000);
      },
    );
    current.current = call;
    setState({ ...call.state });
    try {
      if (publishAudio)
        try {
          const stream = await captureDevice("audio", input);
          const microphone = stream.getAudioTracks()[0];
          if (!microphone) {
            stream.getTracks().forEach((t) => t.stop());
            throw Error("Микрофон не предоставил аудиопоток.");
          }
          call.microphoneOnConnect(microphone);
        } catch (error) {
          call.notice(voiceError(error));
        }
      if (attempt !== generation.current) {
        call.dispose();
        return;
      }
      await call.open(device.current);
    } catch (error) {
      call.fail(voiceError(error));
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }
  async function captureDevice(kind: "audio" | "camera", selected: string) {
    const constraints: MediaStreamConstraints =
      kind === "audio"
        ? {
            audio: {
              deviceId: selected ? { exact: selected } : undefined,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          }
        : {
            audio: false,
            video: {
              width: { ideal: quality === "720" ? 1280 : 640, max: 1280 },
              height: { ideal: Number(quality), max: 720 },
              frameRate: { ideal: 24, max: 30 },
              deviceId: selected ? { exact: selected } : undefined,
            },
          };
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      if (
        !selected ||
        !(error instanceof DOMException) ||
        !(
          error.name === "NotFoundError" ||
          (error.name === "OverconstrainedError" &&
            (error as OverconstrainedError).constraint === "deviceId")
        )
      ) throw error;
      if (kind === "audio") setInput("");
      else setCamera("");
      const fallback = kind === "audio" ? constraints.audio : constraints.video;
      if (fallback && typeof fallback === "object") delete fallback.deviceId;
      return navigator.mediaDevices.getUserMedia(constraints);
    }
  }
  async function capture(kind: MediaKind, replace = false, selected?: string) {
    const call = current.current;
    if (!call || busy || captureInFlight.current === call) return;
    captureInFlight.current = call;
    setBusy(true);
    let captured: MediaStreamTrack | undefined;
    try {
      if (call.state.local[kind] && !replace) {
        await call.publish(kind, null);
        if (kind === "audio") audioWanted.current = false;
        return;
      }
      const stream =
        kind === "screen"
          ? await navigator.mediaDevices.getDisplayMedia({
              video: {
                width: { max: 1280 },
                height: { max: 720 },
                frameRate: { ideal: 24, max: 30 },
              },
              audio: false,
            })
          : await captureDevice(kind, selected ?? (kind === "audio" ? input : camera));
      if (current.current !== call) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = kind === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach((t) => t.stop());
        throw Error("Устройство не предоставило медиапоток.");
      }
      stream.getTracks().filter((t) => t !== track).forEach((t) => t.stop());
      captured = track;
      await call.publish(kind, track, quality === "720" ? 1200000 : 600000);
      if (kind === "audio") audioWanted.current = true;
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch (error) {
      captured?.stop();
      report(error);
    } finally {
      if (captureInFlight.current === call) captureInFlight.current = null;
      if (current.current === call) setBusy(false);
    }
  }
  function toggleDeaf() {
    setDeaf((v) => !v);
    if (!deaf) stopSounds();
    void audioContext.current?.resume().catch(report);
    document
      .querySelectorAll<HTMLMediaElement>(".voice-panel video")
      .forEach((v) => void v.play().catch(report));
  }
  function expand() {
    if (!state) return;
    setExpanded(true);
    navigate({
      tab: "guilds",
      guild: state.room?.guild_id ?? guild.current,
      kind: "channel",
      room: state.channelID,
    });
  }
  const own = state?.room?.participants.find((p) => p.id === state.participantID);
  const toggleMic = () => {
    if (state?.status === "connected") {
      void capture("audio");
    } else if (!state) setMuteOnJoin((v) => !v);
  };
  return (
    <VoiceContext.Provider
      value={{
        state,
        join,
        leave,
        muted: state ? !state.local.audio : muteOnJoin,
        deaf,
        busy: busy || (!!state && (state.status !== "connected" || !own?.can_speak)),
        toggleMic,
        toggleDeaf,
        expand,
        chatOpen,
        setChatOpen,
        setChatAvailable,
        setInviteHandler: (handler) => {
          inviteHandler.current = handler;
          setInviteAvailable(!!handler);
        },
      }}
    >
      {children}
      {state && (
        <VoiceStage
          state={state}
          busy={busy}
          deaf={deaf}
          audioContext={audioContext.current}
          devices={devices}
          input={input}
          camera={camera}
          sink={sink}
          quality={quality}
          setInput={setInput}
          setCamera={setCamera}
          setSink={setSink}
          setQuality={setQuality}
          capture={capture}
          leave={leave}
          reconnect={() => join(state.channelID, state.name, false, audioWanted.current)}
          toggleDeaf={toggleDeaf}
          report={report}
          expanded={expanded}
          expand={expand}
          collapse={() => setExpanded(false)}
          chatOpen={chatOpen && chatAvailable}
          chatAvailable={chatAvailable}
          setChatOpen={setChatOpen}
          onInvite={inviteAvailable ? () => inviteHandler.current?.() : undefined}
          sounds={sounds}
          soundsLoading={soundsLoading}
          soundBusy={soundBusy}
          canUploadSounds={canUploadSounds}
          soundVolume={soundVolume}
          setSoundVolume={setSoundVolume}
          nowPlaying={nowPlaying}
          loadSounds={() => loadSounds(state.channelID)}
          playSound={playSound}
          uploadSound={uploadSound}
        />
      )}
    </VoiceContext.Provider>
  );
}
