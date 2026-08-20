import {
  Check,
  ChevronDown,
  Code2,
  Copy,
  Download,
  Expand,
  Eye,
  File,
  Folder,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react'

const icons = {
  sparkles: Sparkles,
  chevron: ChevronDown,
  plus: Plus,
  more: MoreHorizontal,
  message: MessageSquare,
  eye: Eye,
  file: File,
  send: Send,
  attach: Paperclip,
  undo: Undo2,
  check: Check,
  code: Code2,
  refresh: RefreshCw,
  expand: Expand,
  x: X,
  download: Download,
  folder: Folder,
  copy: Copy,
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof icons

type IconProps = {
  name: IconName
  size?: number
}

export function Icon({ name, size = 18 }: IconProps) {
  const Component = icons[name]
  return <Component className="icon" size={size} strokeWidth={1.8} aria-hidden="true" />
}
