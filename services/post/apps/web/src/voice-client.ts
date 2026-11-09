import { ApiError, api } from "./identity-api";
import { requestID } from "./request-id";
import type {
  VoiceCommand,
  VoiceFrame,
  VoiceJoin,
  VoiceRoomState,
  VoiceStats,
} from "../../../packages/contracts/generated/ts/models";

export type MediaKind = "audio" | "camera" | "screen";
export type SoundPlayback = {
  schema_version: 1;
  op: "sound_played";
  play_id: string;
  sound_id: string;
  name: string;
  emoji: string;
  actor_id: string;
  audio_url: string;
};
const kinds: MediaKind[] = ["audio", "camera", "screen"];
export type CallState = {
  status: "connecting" | "connected" | "disconnected";
  channelID: string;
  name: string;
  participantID: string;
  error: string;
  room?: VoiceRoomState;
  tracks: Map<string, MediaStreamTrack>;
  local: Partial<Record<MediaKind, MediaStreamTrack>>;
  stats?: VoiceStats;
  rtt?: number;
};

const errors: Record<string, string> = {
  room_full: "В комнате уже 6 участников.",
  voice_capacity: "Голосовой сервис достиг лимита комнат.",
  publish_denied: "Публикация запрещена правами канала.",
  access_revoked: "Доступ к звонку отозван или сессия истекла.",
  transport_or_access_lost: "Медиасоединение потеряно или доступ истёк.",
  authority_unavailable: "Не удалось подтвердить актуальные права. Звонок завершён.",
  device_in_call: "В этой вкладке ещё завершается предыдущий звонок. Повторите подключение.",
};
export function voiceError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError")
      return "Доступ к устройству не разрешён. Можно продолжить без публикации.";
    if (error.name === "NotFoundError") return "Устройство не найдено.";
    if (error.name === "NotReadableError") return "Устройство занято или недоступно.";
  }
  return error instanceof Error ? (errors[error.message] ?? error.message) : "Ошибка звонка.";
}

export function receiveSlot(mid: string, room: VoiceRoomState) {
  const subscription = room.subscriptions.find((s) => s.mid === mid);
  const publication = room.publications.find((p) => p.id === subscription?.publication_id);
  return publication?.active ? publication : undefined;
}

export class VoiceConnection {
  state: CallState;
  pc?: RTCPeerConnection;
  private socket?: WebSocket;
  private senders: RTCRtpSender[] = [];
  private pending = new Map<
    string,
    {
      resolve: (frame: VoiceFrame) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private timer?: ReturnType<typeof setInterval>;
  private deadline?: ReturnType<typeof setTimeout>;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private serverConnected = false;
  private refreshInFlight = false;
  private deviceID = "";
  private callID = "";
  private initialAudio?: MediaStreamTrack;
  private changed: (state: CallState) => void;
  private onSoundPlayed?: (event: SoundPlayback) => void;

  constructor(
    channelID: string,
    name: string,
    changed: (state: CallState) => void,
    onSoundPlayed?: (event: SoundPlayback) => void,
  ) {
    this.state = {
      status: "connecting",
      channelID,
      name,
      participantID: "",
      error: "",
      tracks: new Map(),
      local: {},
    };
    this.changed = changed;
    this.onSoundPlayed = onSoundPlayed;
  }
  private emit() {
    this.changed({
      ...this.state,
      tracks: new Map(this.state.tracks),
      local: { ...this.state.local },
    });
  }
  notice(message: string) {
    this.state.error = message;
    this.emit();
  }
  microphoneOnConnect(track: MediaStreamTrack) {
    if (this.stopped) track.stop();
    else this.initialAudio = track;
  }

  private async openSignaling(path: string): Promise<WebSocket> {
    const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.stopped) throw Error("Звонок завершён.");
      const socket = new WebSocket(url);
      this.socket = socket;
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(Error("Голосовой сервер не отвечает."));
          }, 6000);
          socket.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };
          socket.onerror = () => {
            clearTimeout(timeout);
            reject(Error("Голосовой сервер недоступен."));
          };
          socket.onclose = () => {
            clearTimeout(timeout);
            reject(Error("Голосовое соединение закрылось."));
          };
        });
        if (this.stopped) throw Error("Звонок завершён.");
        return socket;
      } catch (error) {
        socket.onopen = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
        if (this.socket === socket) this.socket = undefined;
        if (this.stopped || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    throw Error("Голосовой сервер недоступен.");
  }

  async open(deviceID: string) {
    if (!window.isSecureContext || !window.RTCPeerConnection)
      throw Error("Для WebRTC нужен HTTPS или localhost и поддерживаемый браузер.");
    this.deviceID = deviceID;
    this.callID = requestID();
    const join = await api<VoiceJoin>(`/channels/${this.state.channelID}/voice-join`, "POST", {
      device_id: deviceID,
      call_id: this.callID,
    });
    if (this.stopped) return;
    const pc = (this.pc = new RTCPeerConnection({
      iceServers: join.ice_servers,
      bundlePolicy: "max-bundle",
    }));
    for (let n = 0; n < 21; n++) {
      const kind = n % 3 === 0 ? "audio" : "video";
      const transceiver = pc.addTransceiver(kind, { direction: n < 3 ? "sendonly" : "recvonly" });
      const codecs = RTCRtpReceiver.getCapabilities(kind)?.codecs.filter(
        (c) => c.mimeType.toLowerCase() === (kind === "audio" ? "audio/opus" : "video/vp8"),
      );
      if (!codecs?.length) throw Error("Этот браузер не поддерживает Opus/VP8.");
      transceiver.setCodecPreferences(codecs);
      if (n < 3) this.senders.push(transceiver.sender);
    }
    pc.ontrack = (event) => {
      if (event.transceiver.mid) this.state.tracks.set(event.transceiver.mid, event.track);
      event.track.onended = () => {
        if (event.transceiver.mid && this.state.tracks.get(event.transceiver.mid) === event.track)
          this.state.tracks.delete(event.transceiver.mid);
        this.emit();
      };
      this.emit();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        this.fail("Соединение WebRTC потеряно. Подключитесь заново.");
      } else if (pc.connectionState === "disconnected") {
        if (!this.disconnectTimer)
          this.disconnectTimer = setTimeout(() => {
            this.disconnectTimer = undefined;
            this.fail("Соединение WebRTC потеряно. Подключитесь заново.");
          }, 12000);
      } else if (pc.connectionState === "connected") {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = undefined;
        this.connected();
      }
    };
    const socket = await this.openSignaling(join.signaling_path);
    socket.onmessage = (message) => {
      try {
        this.frame(JSON.parse(message.data) as VoiceFrame);
      } catch {
        this.fail("Некорректный ответ голосового сервиса.");
      }
    };
    socket.onclose = () => {
      if (!this.stopped) this.fail("Соединение с голосовым сервисом закрыто.");
    };
    socket.onerror = () => socket.close();
    if (this.stopped) return;
    const hello = await this.command("join", { grant: join.grant });
    this.state.participantID = hello.participant_id!;
    this.timer = setInterval(() => {
      void this.command("ping").catch(() => {});
      void pc
        .getStats()
        .then((stats) => {
          stats.forEach((report) => {
            if (
              report.type === "candidate-pair" &&
              report.nominated &&
              report.state === "succeeded"
            )
              this.state.rtt = report.currentRoundTripTime;
          });
          this.emit();
        })
        .catch(() => {});
    }, 5000);
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise<void>((resolve, reject) => {
      if (pc.iceGatheringState === "complete") {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        pc.onicegatheringstatechange = null;
        reject(Error("ICE не собрал кандидатов. Проверьте STUN/TURN."));
      }, 7000);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(timeout);
          pc.onicegatheringstatechange = null;
          resolve();
        }
      };
    });
    if (this.stopped) return;
    const answer = await this.command("offer", { sdp: pc.localDescription!.sdp });
    await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    this.deadline = setTimeout(() => {
      if (this.state.status !== "connected")
        this.fail("ICE/DTLS не подключился. Проверьте UDP-порт и TURN.");
    }, 10000);
    this.emit();
  }

  private connected() {
    if (!this.stopped && this.serverConnected && this.pc?.connectionState === "connected") {
      clearTimeout(this.deadline);
      this.state.status = "connected";
      this.emit();
      if (this.initialAudio) {
        const track = this.initialAudio;
        this.initialAudio = undefined;
        void this.publish("audio", track).catch((error) => this.notice(voiceError(error)));
      }
    }
  }
  private frame(frame: VoiceFrame) {
    if (frame.schema_version !== 1) throw Error("protocol");
    if (frame.op === "refresh_required") {
      void this.refreshGrant();
      return;
    }
    if ((frame.op as string) === "sound_played") {
      const sound = frame as unknown as SoundPlayback;
      if (
        typeof sound.audio_url === "string" &&
        sound.audio_url.startsWith("/api/v1/voice/playbacks/")
      )
        this.onSoundPlayed?.(sound);
      return;
    }
    if (frame.request_id) {
      const request = this.pending.get(frame.request_id);
      if (request) {
        clearTimeout(request.timer);
        this.pending.delete(frame.request_id);
        if (frame.op === "error") request.reject(Error(frame.code));
        else request.resolve(frame);
      }
    }
    if (frame.op === "connected") {
      this.serverConnected = true;
      this.connected();
    }
    if (frame.op === "closed") this.fail(errors[frame.code ?? ""] ?? "Звонок завершён сервером.");
    if (frame.op === "stats") {
      this.state.stats = frame.stats;
      this.emit();
    }
    if (frame.op === "room" && frame.room) {
      this.state.room = frame.room;
      const own = frame.room.participants.find((p) => p.id === this.state.participantID);
      for (const kind of kinds) {
        if (own && !(kind === "audio" ? own.can_speak : own.can_stream) && this.state.local[kind]) {
          this.state.local[kind]?.stop();
          delete this.state.local[kind];
          void this.senders[kinds.indexOf(kind)]?.replaceTrack(null).catch(() => {});
        }
      }
      this.emit();
    }
  }
  private async refreshGrant() {
    if (this.stopped || this.refreshInFlight) return;
    this.refreshInFlight = true;
    try {
      const query = new URLSearchParams({ device_id: this.deviceID, call_id: this.callID });
      const join = await api<VoiceJoin>(
        `/channels/${this.state.channelID}/voice-access?${query}`,
      );
      if (!this.stopped) await this.command("refresh", { grant: join.grant });
    } catch (error) {
      if (this.stopped) return;
      if (error instanceof ApiError && [401, 403, 404].includes(error.status))
        this.fail("Доступ к звонку отозван или сессия истекла.");
      else if (
        error instanceof Error &&
        ["invalid_grant", "grant_mismatch", "access_expired"].includes(error.message)
      )
        this.fail("Доступ к звонку отозван или сессия истекла.");
    } finally {
      this.refreshInFlight = false;
    }
  }
  command(
    op: VoiceCommand["op"] | "play_sound",
    fields: Partial<VoiceCommand> & { sound_id?: string } = {},
  ): Promise<VoiceFrame> {
    if (this.stopped || this.socket?.readyState !== WebSocket.OPEN)
      return Promise.reject(Error("Голосовое соединение закрыто."));
    const request_id = requestID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request_id);
        reject(Error("Команда звонка не подтверждена."));
      }, 5000);
      this.pending.set(request_id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ schema_version: 1, op, request_id, ...fields }));
    });
  }
  playSound(soundID: string) {
    if (this.state.status !== "connected")
      return Promise.reject(Error("Сначала войдите в звонок."));
    return this.command("play_sound", { sound_id: soundID });
  }
  async publish(kind: MediaKind, track: MediaStreamTrack | null, bitrate = 600000) {
    if (this.stopped || this.state.status !== "connected") {
      track?.stop();
      throw Error("Сначала дождитесь подключения WebRTC.");
    }
    const sender = this.senders[kinds.indexOf(kind)];
    const previous = this.state.local[kind];
    try {
      if (!track) await this.command("publish", { kind, active: false });
      await sender.replaceTrack(track);
      if (track) {
        const parameters = sender.getParameters();
        if (parameters.encodings.length) {
          parameters.encodings[0].maxBitrate =
            kind === "audio" ? 64000 : Math.min(bitrate, 1200000);
          await sender.setParameters(parameters);
        }
        await this.command("publish", { kind, active: true });
        track.onended = () => {
          if (this.state.local[kind] === track) {
            this.notice("Источник остановлен браузером или устройство отключено.");
            void this.publish(kind, null).catch((e) => this.notice(voiceError(e)));
          }
        };
      }
      previous?.stop();
      if (track) this.state.local[kind] = track;
      else delete this.state.local[kind];
      this.emit();
    } catch (error) {
      track?.stop();
      previous?.stop();
      delete this.state.local[kind];
      await sender.replaceTrack(null).catch(() => {});
      this.emit();
      throw error;
    }
  }
  async leave() {
    if (!this.stopped && this.socket?.readyState === WebSocket.OPEN)
      await this.command("leave").catch(() => {});
    this.dispose();
  }
  fail(message: string) {
    if (this.stopped) return;
    this.dispose();
    this.state.error = message;
    this.emit();
  }
  dispose() {
    this.stopped = true;
    this.initialAudio?.stop();
    this.initialAudio = undefined;
    clearInterval(this.timer);
    clearTimeout(this.deadline);
    clearTimeout(this.disconnectTimer);
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(Error("Звонок завершён."));
    }
    this.pending.clear();
    for (const track of Object.values(this.state.local)) track?.stop();
    this.state.local = {};
    this.state.tracks.clear();
    this.state.room = undefined;
    if (this.pc) {
      this.pc.onconnectionstatechange = null;
      this.pc.close();
    }
    this.socket?.close();
    this.state.status = "disconnected";
  }
}
