export default function LoudArtistBadge({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <img
      className={`loud-artist-badge${compact ? " is-compact" : ""}`}
      src="/loud-artist-badge.svg"
      alt="LOUD Артист"
      width={155}
      height={32}
    />
  );
}
