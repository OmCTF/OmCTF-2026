import { useEffect, useRef, useState } from "react";
import type {
  PrivacySettings,
  PublicProfile,
} from "../../../packages/contracts/generated/ts/models";
import { SelectField } from "./SelectField";

const avatarOptions = [
  { value: "violet", label: "Лавандовый" },
  { value: "mint", label: "Мятный" },
  { value: "amber", label: "Янтарный" },
  { value: "rose", label: "Розовый" },
  { value: "sky", label: "Небесный" },
] as const;

export function ProfileAvatarField({
  value,
  onChange,
  disabled,
}: {
  value: PublicProfile["avatar"];
  onChange: (value: PublicProfile["avatar"]) => void;
  disabled: boolean;
}) {
  return (
    <label>
      Цвет аватара
      <SelectField
        name="avatar"
        label="Цвет аватара"
        value={value}
        options={avatarOptions}
        disabled={disabled}
        onChange={(next) => {
          const option = avatarOptions.find((item) => item.value === next);
          if (option) onChange(option.value);
        }}
      />
    </label>
  );
}

const dmOptions = [
  { value: "everyone", label: "Все пользователи" },
  { value: "friends", label: "Только друзья" },
  { value: "nobody", label: "Никто" },
] as const;

export function PrivacyPolicyFields({
  settings,
  disabled,
}: {
  settings: PrivacySettings;
  disabled: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [friendRequests, setFriendRequests] = useState(settings.friend_requests);
  const [dmPolicy, setDMPolicy] = useState(settings.dm_policy);
  useEffect(() => {
    const form = root.current?.closest("form");
    const reset = () => {
      setFriendRequests(settings.friend_requests);
      setDMPolicy(settings.dm_policy);
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [settings.friend_requests, settings.dm_policy]);
  return (
    <div className="privacy-policy-fields" ref={root}>
      <label className="switch-row privacy-friend-requests">
        <span>
          <strong>Разрешить запросы дружбы</strong>
          <small>{friendRequests === "everyone" ? "Все пользователи" : "Никто"}</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Разрешить запросы дружбы"
          checked={friendRequests === "everyone"}
          disabled={disabled}
          onChange={(event) => setFriendRequests(event.target.checked ? "everyone" : "nobody")}
        />
      </label>
      <input type="hidden" name="friend_requests" value={friendRequests} disabled={disabled} />
      <label>
        Кто сможет писать в личные сообщения
        <SelectField
          name="dm_policy"
          label="Кто сможет писать в личные сообщения"
          value={dmPolicy}
          options={dmOptions}
          disabled={disabled}
          onChange={(next) => {
            const option = dmOptions.find((item) => item.value === next);
            if (option) setDMPolicy(option.value);
          }}
        />
      </label>
    </div>
  );
}
