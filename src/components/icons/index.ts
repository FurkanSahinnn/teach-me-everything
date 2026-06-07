/**
 * Centralized icon exports — TME ikonografisi tek yerden lucide-react.
 * Yeni ikon eklerken önce buraya re-export et; sayfalar bu barrel'dan tüketir.
 *
 * Kural:
 *   import { Search, Plus } from "@/components/icons"
 * yerine
 *   import { Search, Plus } from "lucide-react"
 * yazma — barrel "tek doğruluk kaynağı".
 */
export {
  // Navigation
  Menu,
  X,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  // Actions
  Plus,
  Minus,
  Check,
  Search,
  Filter,
  MoreHorizontal,
  MoreVertical,
  Send,
  Save,
  RotateCcw,
  RefreshCw,
  Loader2,
  // Files & content
  FileText,
  File,
  Folder,
  Upload,
  Download,
  Image,
  Paperclip,
  // App chrome
  Bell,
  Settings,
  Settings2,
  User,
  LogOut,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Shield,
  ShieldCheck,
  Key,
  // Communication
  MessageSquare,
  MessageCircle,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  // Editing
  Edit,
  Edit2,
  Edit3,
  Trash,
  Trash2,
  Copy,
  // Feedback
  AlertCircle,
  AlertTriangle,
  Info,
  HelpCircle,
  CheckCircle2,
  XCircle,
  // UI
  Sun,
  Moon,
  Palette,
  Layout,
  LayoutGrid,
  Sparkles,
  Zap,
  Star,
  // Workspace specific
  BookOpen,
  BookMarked,
  Brain,
  Lightbulb,
  Target,
  Calendar,
  Clock,
  Map,
  Network,
  Layers,
  Grid,
  List,
  // Audio / podcast
  Headphones,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  // External
  ExternalLink,
  Link as LinkIcon,
  Globe,
} from "lucide-react";
