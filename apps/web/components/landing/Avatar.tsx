const AVATAR_COLORS = ["#737373", "#5f5f5f", "#4d4d4d", "#3f3f3f", "#333333"];

interface AvatarProps {
  name: string;
  colorIndex?: number;
  size?: number;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Initials-based avatar stand-in for the brand photography. */
export default function Avatar({ name, colorIndex = 0, size = 34 }: AvatarProps) {
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, ${AVATAR_COLORS[colorIndex % AVATAR_COLORS.length]}, #0f172a)`,
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function AvatarGroup({ names }: { names: string[] }) {
  return (
    <span className="avatar-group">
      {names.map((name, index) => (
        <Avatar key={name} name={name} colorIndex={index} size={34} />
      ))}
    </span>
  );
}
