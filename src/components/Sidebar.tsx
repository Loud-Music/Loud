import { SidebarSurface, SidebarMenuButton, useSidebar } from "./ui/sidebar";
import { ScrollFade } from "@animate-ui/react/primitives/effects/scroll-fade";
import { Button } from "@animate-ui/react/primitives/buttons/button";
import { version } from "../../package.json";
import {
  Waveform,
  Home,
  Radio,
  Music,
  Disc,
  Users,
  Heart,
  Plus,
  Queue,
  Settings,
  Download,
} from "../icons";
import type { LoudIcon } from "../icons";
import type { Playlist } from "../lib/library";
import type { LocalAccount } from "../lib/accounts";
import type { View } from "../lib/navigation";
import { viewLabel } from "../lib/navigation";
import IconButton from "./IconButton";
type Props = {
  view: View;
  favorites: string[];
  downloadCount: number;
  playlists: Playlist[];
  account: LocalAccount;
  onSwitchAccount: () => void;
  navigate: (view: View) => void;
  setModal: (modal: "playlist" | "settings") => void;
};
export default function Sidebar({
  view,
  favorites,
  downloadCount,
  playlists,
  account,
  onSwitchAccount,
  navigate,
  setModal,
}: Props) {
  const { setOpenMobile } = useSidebar();
  const go = (next: View) => {
    navigate(next);
    setOpenMobile(false);
  };
  const chooseModal = (next: "playlist" | "settings") => {
    setOpenMobile(false);
    setModal(next);
  };
  const navItem = (name: View, Icon: LoudIcon, badge?: number) => (
    <SidebarMenuButton
      label={viewLabel(name)}
      active={view === name}
      key={name}
      aria-label={viewLabel(name)}
      className={`nav-item ${view === name ? "selected" : ""}`}
      onClick={() => go(name)}
    >
      <Icon size={19} />
      <span>{viewLabel(name)}</span>
      {badge !== undefined && <span className="nav-count">{badge}</span>}
    </SidebarMenuButton>
  );

  return (
    <SidebarSurface>
      <Button
        className="brand"
        onClick={() => go("Listen Now")}
        aria-label="Главная Loud"
      >
        <img
          className="brand-wordmark"
          src="/loud-logo.svg"
          alt="LOUD"
          width={136}
          height={42}
        />
        <img
          className="brand-symbol"
          src="/loud-symbol.svg"
          alt=""
          width={32}
          height={36}
        />
      </Button>
      <ScrollFade asChild size={16} blur={0} shrink={0}>
        <nav aria-label="Основная навигация">
          {navItem("Моя волна", Waveform)}
          {navItem("Listen Now", Home)}
          {navItem("Discover", Radio)}
          <span
            data-sidebar="group-label"
            className="nav-heading library-heading"
          >
            Медиатека
          </span>
          {navItem("Songs", Music)}
          {navItem("Albums", Disc)}
          {navItem("Artists", Users)}
          {navItem("Favorites", Heart, favorites.length)}
          {navItem("Downloads", Download, downloadCount || undefined)}
          <div className="nav-heading heading-with-action">
            <span>Плейлисты</span>
            <IconButton
              icon={Plus}
              label="Создать плейлист"
              onClick={() => chooseModal("playlist")}
            />
          </div>
          <div className="playlist-nav">
            {playlists.map((p, i) => (
              <SidebarMenuButton
                label={p.name}
                active={view === `playlist:${p.id}`}
                key={p.id}
                aria-label={p.name}
                className={`nav-item ${view === `playlist:${p.id}` ? "selected" : ""}`}
                onClick={() => go(`playlist:${p.id}`)}
              >
                <span className={`playlist-icon playlist-color-${i % 3}`}>
                  <Queue size={14} />
                </span>
                <span>{p.name}</span>
              </SidebarMenuButton>
            ))}
          </div>
        </nav>
      </ScrollFade>
      <div className="sidebar-bottom">
        <Button
          className="profile account-profile"
          onClick={() => {
            setOpenMobile(false);
            onSwitchAccount();
          }}
          aria-label="Сменить профиль"
        >
          <span className="avatar">
            <Users size={18} />
          </span>
          <span>
            <strong>{account.name}</strong>
            <small>Сменить профиль</small>
          </span>
        </Button>
        <Button
          className="profile"
          aria-label="Настройки"
          onClick={() => {
            chooseModal("settings");
          }}
        >
          <span className="avatar">
            <Settings size={19} />
          </span>
          <span>
            <strong>Настройки</strong>
            <small>Loud {version}</small>
          </span>
          <Settings size={17} />
        </Button>
      </div>
    </SidebarSurface>
  );
}
