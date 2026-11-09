import { useEffect, useState } from "react";
import type { GuildInfo } from "../../../packages/contracts/generated/ts/models";
import { api } from "./identity-api";
import { navigate, useRoute } from "./navigation";
import { Icon } from "./Icons";
import { BrandMark } from "./Brand";

export function ServerRail() {
  const route = useRoute();
  const [guilds, setGuilds] = useState<GuildInfo[]>([]);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void api<{ items: GuildInfo[] }>("/guilds")
        .then((value) => {
          if (active) setGuilds(value.items);
        })
        .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener("svyaz:guilds-changed", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("svyaz:guilds-changed", refresh);
    };
  }, []);
  return (
    <nav className="server-rail" aria-label="Ваши серверы">
      <button
        className="rail-home"
        aria-label="Личные сообщения"
        title="Личные сообщения"
        aria-current={route.tab !== "guilds" ? "page" : undefined}
        onClick={() => navigate({ tab: "friends" })}
      >
        <BrandMark size={30} />
      </button>
      <div className="rail-divider" />
      <div className="rail-servers">
        {guilds.map((guild) => (
          <button
            key={guild.id}
            className={`rail-server ${guild.icon}`}
            aria-label={guild.name}
            title={guild.name}
            aria-current={route.guild === guild.id ? "page" : undefined}
            onClick={() => navigate({ tab: "guilds", guild: guild.id })}
          >
            {Array.from(guild.name)[0]?.toUpperCase()}
          </button>
        ))}
        <button
          className="rail-add"
          aria-label="Добавить сервер"
          title="Добавить сервер"
          onClick={() =>
            navigate({
              ...route,
              serverAction: "choose",
            })
          }
        >
          <Icon name="plus" size={26} />
        </button>
      </div>
      <div className="rail-bottom">
        <button aria-label="Поиск" title="Поиск" onClick={() => navigate({ tab: "search" })}>
          <Icon name="search" />
        </button>
      </div>
    </nav>
  );
}
