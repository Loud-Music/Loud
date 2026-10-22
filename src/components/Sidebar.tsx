import type { RefObject, Dispatch, SetStateAction } from "react";
import {
  AudioLines,
  House,
  Radio,
  Music2,
  Disc3,
  Users,
  Heart,
  Plus,
  ListMusic,
  Search,
  Settings2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Playlist } from "../lib/library";
import type { LocalAccount } from "../lib/accounts";
import type { View, WindowAction } from "../lib/navigation";
import { viewLabel } from "../lib/navigation";
import IconButton from "./IconButton";
type Props = {
  view: View;
  search: string;
  searchInput: RefObject<HTMLInputElement | null>;
  setView: Dispatch<SetStateAction<View>>;
  setSearch: Dispatch<SetStateAction<string>>;
  favorites: string[];
  playlists: Playlist[];
  account: LocalAccount;
  onSwitchAccount: () => void;
  navigate: (view: View) => void;
  windowAction: (action: WindowAction) => Promise<void>;
  setModal: (modal: "playlist" | "settings") => void;
};
export default function Sidebar({
  view,
  search,
  searchInput,
  setView,
  setSearch,
  favorites,
  playlists,
  account,
  onSwitchAccount,
  navigate,
  windowAction,
  setModal,
}: Props) {
  const navItem = (name: View, Icon: LucideIcon, badge?: number) => (
    <button
      key={name}
      aria-label={viewLabel(name)}
      className={`nav-item ${view === name ? "selected" : ""}`}
      onClick={() => navigate(name)}
    >
      <Icon size={19} strokeWidth={1.65} />
      <span>{viewLabel(name)}</span>
      {badge !== undefined && <span className="nav-count">{badge}</span>}
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-top" data-tauri-drag-region>
        <div className="traffic-lights">
          <button
            aria-label="Закрыть окно"
            onClick={() => void windowAction("close")}
            className="traffic red"
          />
          <button
            aria-label="Свернуть окно"
            onClick={() => void windowAction("minimize")}
            className="traffic yellow"
          />
          <button
            aria-label="Развернуть окно"
            onClick={() => void windowAction("toggleMaximize")}
            className="traffic green"
          />
        </div>
      </div>
      <button
        className="brand"
        onClick={() => navigate("Listen Now")}
        aria-label="Главная Loud"
      >
        <span className="brand-icon">
          <img src="/mascot.svg" alt="" width={32} height={28} />
        </span>
        <span>Loud</span>
      </button>
      <label className="search-field">
        <Search size={17} />
        <input
          ref={searchInput}
          aria-label="Поиск музыки"
          placeholder="Поиск музыки"
          value={search}
          onChange={(e) => {
            setView("Discover");
            setSearch(e.target.value);
          }}
        />
        <kbd>⌘ K</kbd>
      </label>
      <nav aria-label="Основная навигация">
        {navItem("Моя волна", AudioLines)}
        {navItem("Listen Now", House)}
        {navItem("Discover", Radio)}
        <span className="nav-heading library-heading">Медиатека</span>
        {navItem("Songs", Music2)}
        {navItem("Albums", Disc3)}
        {navItem("Artists", Users)}
        {navItem("Favorites", Heart, favorites.length)}
        <div className="nav-heading heading-with-action">
          <span>Плейлисты</span>
          <IconButton
            icon={Plus}
            label="Создать плейлист"
            onClick={() => setModal("playlist")}
          />
        </div>
        <div className="playlist-nav">
          {playlists.map((p, i) => (
            <button
              key={p.id}
              aria-label={p.name}
              className={`nav-item ${view === `playlist:${p.id}` ? "selected" : ""}`}
              onClick={() => navigate(`playlist:${p.id}`)}
            >
              <span className={`playlist-icon playlist-color-${i % 3}`}>
                <ListMusic size={14} />
              </span>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </nav>
      <div className="sidebar-bottom">
        <button
          className="profile account-profile"
          onClick={onSwitchAccount}
          aria-label="Сменить профиль"
        >
          <span className="avatar">
            <Users size={18} />
          </span>
          <span>
            <strong>{account.name}</strong>
            <small>Сменить профиль</small>
          </span>
        </button>
        <button
          className="profile"
          aria-label="Настройки"
          onClick={() => {
            setModal("settings");
          }}
        >
          <span className="avatar">
            <Settings2 size={19} />
          </span>
          <span>
            <strong>Настройки</strong>
            <small>Loud 0.2.0</small>
          </span>
          <Settings2 size={17} />
        </button>
      </div>
    </aside>
  );
}
