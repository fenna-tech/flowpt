// Minimal stroke icons (24px grid, lucide-style paths) so the UI needs no icon dependency.
function Icon({
  children,
  className = 'size-5'
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

type P = { className?: string }

export const HomeIcon = (p: P): React.JSX.Element => (
  <Icon {...p}>
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </Icon>
)

export const UsersIcon = (p: P): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
  </Icon>
)

export const SettingsIcon = (p: P): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icon>
)

export const LogOutIcon = (p: P): React.JSX.Element => (
  <Icon {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </Icon>
)

export const SearchIcon = (p: P): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
)

export const PlusIcon = (p: P): React.JSX.Element => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const ChevronLeftIcon = (p: P): React.JSX.Element => (
  <Icon {...p}>
    <path d="m15 18-6-6 6-6" />
  </Icon>
)

export function LogoMark({ className = 'size-9' }: P): React.JSX.Element {
  const f = (
    <>
      <rect x="34" y="16" width="11" height="48" rx="5.5" />
      <rect x="34" y="16" width="30" height="11" rx="5.5" />
      <rect x="34" y="35" width="21" height="11" rx="5.5" />
    </>
  )
  return (
    <svg viewBox="0 0 80 80" className={className} aria-hidden="true">
      <rect width="80" height="80" rx="20" fill="#0a3d34" />
      <g transform="skewX(-10) translate(10 0)">
        <g fill="#1f7a68" opacity="0.5" transform="translate(-14 0)">
          {f}
        </g>
        <g fill="#1f7a68" opacity="0.8" transform="translate(-10 0)">
          {f}
        </g>
        <g fill="#7fc4b3" opacity="0.9" transform="translate(-6 0)">
          {f}
        </g>
        <g fill="#7fc4b3" transform="translate(-3 0)">
          {f}
        </g>
        <g fill="#fff">{f}</g>
      </g>
    </svg>
  )
}
